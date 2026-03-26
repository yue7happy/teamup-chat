const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const cors = require('cors');
const fs = require('fs');
const path = require('path');

const app = express();
const server = http.createServer(app);
const io = new Server(server, {
  cors: {
    origin: "*",
    methods: ["GET", "POST"]
  }
});

app.use(cors());
app.use(express.json());

const DATA_FILE = path.join(__dirname, 'data.json');

const defaultData = {
  users: [
    { id: '1', username: '紫罗兰', password: '152720', role: 'owner' }
  ],
  rooms: [
    { id: 'lobby', name: '大厅', status: 'idle', users: [], isDefault: true }
  ]
};

function loadData() {
  if (fs.existsSync(DATA_FILE)) {
    return JSON.parse(fs.readFileSync(DATA_FILE, 'utf8'));
  }
  saveData(defaultData);
  return defaultData;
}

function saveData(data) {
  fs.writeFileSync(DATA_FILE, JSON.stringify(data, null, 2));
}

let data = loadData();

const onlineUsers = new Map();

// 初始化用户在线状态
function initUserStatus() {
  data.users.forEach(user => {
    user.online = false;
  });
  saveData(data);
}

// 初始化用户状态
initUserStatus();

app.post('/api/login', (req, res) => {
  const { username, password } = req.body;
  const user = data.users.find(u => u.username === username && u.password === password);
  
  if (user) {
    // 设置用户在线状态
    user.online = true;
    saveData(data);
    
    // 广播用户状态更新
    io.emit('user_status_updated', {
      id: user.id,
      username: user.username,
      role: user.role,
      online: true
    });
    
    res.json({ success: true, user: { id: user.id, username: user.username, role: user.role, online: true } });
  } else {
    res.json({ success: false, message: '用户名或密码错误' });
  }
});

app.get('/api/rooms', (req, res) => {
  const roomsWithUserCount = data.rooms.map(room => ({
    ...room,
    userCount: room.users.length
  }));
  res.json(roomsWithUserCount);
});

app.post('/api/rooms', (req, res) => {
  const { name, createdBy } = req.body;
  const newRoom = {
    id: Date.now().toString(),
    name,
    status: 'idle',
    users: [],
    createdBy,
    isDefault: false
  };
  data.rooms.push(newRoom);
  saveData(data);
  
  io.emit('roomsUpdated', data.rooms.map(room => ({
    ...room,
    userCount: room.users.length
  })));
  
  res.json({ success: true, room: newRoom });
});

app.post('/api/users', (req, res) => {
  const { username, createdBy } = req.body;
  
  if (data.users.find(u => u.username === username)) {
    return res.json({ success: false, message: '用户名已存在' });
  }
  
  const newUser = {
    id: Date.now().toString(),
    username,
    password: '123456',
    role: 'user',
    createdBy
  };
  data.users.push(newUser);
  saveData(data);
  
  // 广播用户添加成功消息
  console.log('广播user_added事件，新用户:', newUser.username);
  io.emit('user_added', { success: true, user: { id: newUser.id, username: newUser.username, role: newUser.role } });
  
  res.json({ success: true, user: { id: newUser.id, username: newUser.username, role: newUser.role } });
});

app.get('/api/users', (req, res) => {
  const users = data.users.map(user => ({
    id: user.id,
    username: user.username,
    role: user.role,
    online: user.online || false
  }));
  res.json(users);
});

app.put('/api/users/:id/role', (req, res) => {
  const { id } = req.params;
  const { role } = req.body;
  
  // 不允许修改房主角色
  if (id === '1') {
    return res.json({ success: false, message: '无法修改房主角色' });
  }
  
  const userIndex = data.users.findIndex(user => user.id === id);
  if (userIndex === -1) {
    return res.json({ success: false, message: '用户不存在' });
  }
  
  data.users[userIndex].role = role;
  saveData(data);
  
  // 广播用户角色更新消息
  io.emit('user_updated', { success: true, user: data.users[userIndex] });
  
  res.json({ success: true, message: '角色设置成功' });
});

app.delete('/api/users/:id', (req, res) => {
  const { id } = req.params;
  
  // 不允许删除房主
  if (id === '1') {
    return res.json({ success: false, message: '无法删除房主' });
  }
  
  const userIndex = data.users.findIndex(user => user.id === id);
  if (userIndex === -1) {
    return res.json({ success: false, message: '用户不存在' });
  }
  
  const deletedUser = data.users[userIndex];
  data.users.splice(userIndex, 1);
  saveData(data);
  
  // 广播用户删除消息
  io.emit('user_deleted', { success: true, userId: id });
  
  res.json({ success: true, message: '用户删除成功' });
});

app.delete('/api/rooms/:id', (req, res) => {
  const { id } = req.params;
  
  try {
    console.log('开始删除房间，ID:', id);
    
    // 不允许删除默认大厅
    if (id === 'lobby') {
      console.log('尝试删除默认大厅，拒绝');
      return res.json({ success: false, message: '无法删除默认大厅' });
    }
    
    const roomIndex = data.rooms.findIndex(room => room.id === id);
    if (roomIndex === -1) {
      console.log('房间不存在，ID:', id);
      return res.json({ success: false, message: '房间不存在' });
    }
    
    const deletedRoom = data.rooms[roomIndex];
    console.log('找到房间:', deletedRoom.name, '用户数量:', deletedRoom.users.length);
    
    const roomUsers = [...deletedRoom.users]; // 保存房间内的用户
    console.log('房间用户:', roomUsers.map(u => u.username));
    
    // 将房间内的所有用户移到大厅
    const lobbyRoom = data.rooms.find(room => room.isDefault);
    if (lobbyRoom) {
      console.log('找到大厅:', lobbyRoom.name);
      roomUsers.forEach(user => {
        console.log('处理用户:', user.username, 'ID:', user.id);
        if (!user || !user.id) {
          console.log('无效用户对象:', user);
          return;
        }
        // 检查用户是否已经在大厅中
        const userInLobby = lobbyRoom.users.find(u => u.id === user.id);
        if (!userInLobby) {
          console.log('将用户', user.username, '添加到大厅');
          lobbyRoom.users.push(user);
        } else {
          console.log('用户', user.username, '已经在大厅中');
        }
        
        // 更新在线用户的当前房间
        onlineUsers.forEach((onlineUser, socketId) => {
          if (onlineUser.id === user.id) {
            console.log('更新在线用户', onlineUser.username, '的当前房间为大厅');
            onlineUser.currentRoom = lobbyRoom.id;
            // 广播用户移动消息
            io.emit('user_moved', {
              userId: user.id,
              username: user.username,
              fromRoom: id,
              toRoom: lobbyRoom.id
            });
          }
        });
      });
    }
    
    // 先保存用户移动后的状态
    console.log('保存用户移动后的状态');
    saveData(data);
    console.log('保存成功');
    
    // 然后删除房间
    console.log('删除房间，索引:', roomIndex);
    data.rooms.splice(roomIndex, 1);
    console.log('房间已从内存中删除');
    
    // 保存删除房间后的状态
    console.log('保存删除房间后的状态');
    saveData(data);
    console.log('保存成功');
    
    // 广播房间删除消息
    console.log('广播房间删除消息');
    io.emit('room_deleted', { success: true, roomId: id });
    
    // 广播大厅用户更新
    if (lobbyRoom) {
      console.log('广播大厅用户更新，用户数量:', lobbyRoom.users.length);
      io.to(lobbyRoom.id).emit('roomUsersUpdated', lobbyRoom.users);
    }
    
    // 广播房间列表更新
    console.log('广播房间列表更新');
    broadcastRooms();
    
    console.log('房间删除成功');
    res.json({ success: true, message: '房间删除成功' });
  } catch (error) {
    console.error('删除房间时发生错误:', error);
    console.error('错误堆栈:', error.stack);
    res.json({ success: false, message: '删除房间失败' });
  }
});

function broadcastRooms() {
  const roomsWithUserCount = data.rooms.map(room => ({
    ...room,
    userCount: room.users.length
  }));
  io.emit('roomsUpdated', roomsWithUserCount);
}

io.on('connection', (socket) => {
  console.log('用户连接:', socket.id);
  
  socket.on('join', (userData) => {
    console.log('收到join事件，用户:', userData.username, 'ID:', userData.id);
    
    // 注意：不在join时移除用户，保留用户在房间中的状态
    // 客户端会根据sessionStorage决定是否重新进入房间
    // enterRoom事件会处理房间切换逻辑
    
    onlineUsers.set(socket.id, { ...userData, socketId: socket.id, currentRoom: null });
    console.log('用户已添加到onlineUsers');
    
    // 设置用户在线状态
    const userInData = data.users.find(u => u.id === userData.id);
    if (userInData) {
      console.log('找到用户数据，设置为在线');
      userInData.online = true;
      saveData(data);
      console.log('数据已保存');
      
      // 广播用户状态更新
      console.log('广播user_status_updated事件，用户:', userData.username, '状态: 在线');
      io.emit('user_status_updated', {
        id: userData.id,
        username: userData.username,
        role: userData.role,
        online: true
      });
      console.log('事件已广播');
    } else {
      console.log('未找到用户数据:', userData.id);
    }
    
    broadcastRooms();
    console.log('join事件处理完成');
  });
  
  socket.on('enterRoom', ({ roomId, user }) => {
    const room = data.rooms.find(r => r.id === roomId);
    if (!room) return;
    
    const currentUser = onlineUsers.get(socket.id);
    
    // 先从所有房间中移除该用户（确保不会同时出现在多个房间）
    data.rooms.forEach(r => {
      const userIndex = r.users.findIndex(u => u.id === user.id);
      if (userIndex !== -1) {
        r.users.splice(userIndex, 1);
        if (r.users.length === 0 && !r.isDefault) {
          r.status = 'idle';
        }
        // 通知原房间内的其他用户
        io.to(r.id).emit('roomUsersUpdated', r.users);
      }
    });
    
    // 将用户添加到新房间
    if (!room.users.find(u => u.id === user.id)) {
      // 确保用户对象包含status属性
      const userWithStatus = { ...user, status: user.status || 'idle' };
      room.users.push(userWithStatus);
    }
    
    if (currentUser) {
      currentUser.currentRoom = roomId;
    }
    socket.join(roomId);
    
    saveData(data);
    broadcastRooms();
    io.to(roomId).emit('roomUsersUpdated', room.users);
  });
  
  socket.on('leaveRoom', ({ roomId, user }) => {
    const room = data.rooms.find(r => r.id === roomId);
    if (!room) return;
    
    room.users = room.users.filter(u => u.id !== user.id);
    
    if (room.users.length === 0 && !room.isDefault) {
      room.status = 'idle';
    } else if (room.users.length > 0 && !room.isDefault) {
      // 房间状态已经由用户通过 changeRoomStatus 设置
      // 保持当前状态不变
      console.log('房间', room.name, '当前状态:', room.status);
    }
    
    const currentUser = onlineUsers.get(socket.id);
    if (currentUser) {
      currentUser.currentRoom = null;
    }
    
    socket.leave(roomId);
    
    saveData(data);
    broadcastRooms();
    io.to(roomId).emit('roomUsersUpdated', room.users);
    
    // 广播用户离开消息
    io.emit('user_left', {
      userId: user.id,
      username: user.username,
      roomId: roomId
    });
  });
  
  socket.on('changeRoomStatus', ({ roomId, status, user }) => {
    const room = data.rooms.find(r => r.id === roomId);
    if (!room) return;
    
    room.status = status;
    
    // 当任意用户点击状态按钮时，更新房间内所有在线用户的状态
    room.users.forEach(userInRoom => {
      userInRoom.status = status;
    });
    
    saveData(data);
    
    broadcastRooms();
    // 通知房间内的其他用户
    io.to(roomId).emit('roomUsersUpdated', room.users);
  });
  
  socket.on('send_message', (message) => {
    console.log('收到消息:', message);
    // 广播消息到房间内的所有用户
    io.to(message.roomId).emit('new_message', message);
  });

  socket.on('disconnect', () => {
    console.log('检测到用户断开连接，socket.id:', socket.id);
    const user = onlineUsers.get(socket.id);
    if (user) {
      console.log('断开连接的用户:', user.username, 'ID:', user.id);
      // 设置用户离线状态
      const userInData = data.users.find(u => u.id === user.id);
      if (userInData) {
        console.log('找到用户数据，设置为离线');
        userInData.online = false;
        saveData(data);
        
        // 广播用户状态更新
        console.log('广播user_status_updated事件，用户:', user.username, '状态: 离线');
        io.emit('user_status_updated', {
          id: user.id,
          username: user.username,
          role: user.role,
          online: false
        });
      }
      
      // 从所有房间中移除该用户
      data.rooms.forEach(room => {
        const userIndex = room.users.findIndex(u => u.id === user.id);
        if (userIndex !== -1) {
          console.log('从房间', room.name, '中移除用户', user.username);
          room.users.splice(userIndex, 1);
          
          if (room.users.length === 0 && !room.isDefault) {
            room.status = 'idle';
          } else if (room.users.length > 0 && !room.isDefault) {
            // 房间状态已经由用户通过 changeRoomStatus 设置
            // 保持当前状态不变
            console.log('房间', room.name, '当前状态:', room.status);
          }
          
          // 广播用户离开消息
          io.emit('user_left', {
            userId: user.id,
            username: user.username,
            roomId: room.id
          });
          // 通知房间内的其他用户
          io.to(room.id).emit('roomUsersUpdated', room.users);
        }
      });
      
      // 保存数据
      saveData(data);
      // 广播房间列表更新
      broadcastRooms();
    }
    onlineUsers.delete(socket.id);
    console.log('用户断开连接处理完成:', socket.id);
  });
});

const PORT = process.env.PORT || 3001;
server.listen(PORT, () => {
  console.log(`服务器运行在端口 ${PORT}`);
});
