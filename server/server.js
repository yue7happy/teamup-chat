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
// 房间计时器管理
const roomTimers = new Map();
// 断开连接用户管理（用于延迟处理）
const disconnectedUsers = new Map();
// 断开连接延迟时间（毫秒）
const DISCONNECT_DELAY = 3000;

// 初始化用户在线状态
function initUserStatus() {
  data.users.forEach(user => {
    user.online = false;
  });
  saveData(data);
}

// 初始化房间计时器
function initRoomTimers() {
  data.rooms.forEach(room => {
    if (!room.isDefault && (room.status === 'matching' || room.status === 'gaming')) {
      startRoomTimer(room.id);
    }
  });
}

// 开始房间计时器
function startRoomTimer(roomId) {
  // 清除已有的计时器
  if (roomTimers.has(roomId)) {
    clearInterval(roomTimers.get(roomId));
  }
  
  // 初始化计时数据
  const room = data.rooms.find(r => r.id === roomId);
  if (room) {
    if (!room.timer) {
      room.timer = 0;
    }
    
    // 每秒更新一次计时
    const timer = setInterval(() => {
      const room = data.rooms.find(r => r.id === roomId);
      if (room) {
        room.timer++;
        
        // 保存数据并广播更新
        saveData(data);
        broadcastRooms();
        
        // 检查是否需要自动切换状态（15分钟）
        if (room.timer >= 900) {
          room.status = 'idle';
          room.timer = 0;
          clearInterval(roomTimers.get(roomId));
          roomTimers.delete(roomId);
          saveData(data);
          broadcastRooms();
        }
      }
    }, 1000);
    
    roomTimers.set(roomId, timer);
  }
}

// 停止房间计时器
function stopRoomTimer(roomId) {
  if (roomTimers.has(roomId)) {
    clearInterval(roomTimers.get(roomId));
    roomTimers.delete(roomId);
  }
  
  const room = data.rooms.find(r => r.id === roomId);
  if (room) {
    room.timer = 0;
  }
}

// 初始化用户状态
initUserStatus();
// 初始化房间计时器
initRoomTimers();

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
    userCount: room.users.length,
    timer: room.timer || 0
  }));
  console.log('返回的房间列表：', roomsWithUserCount);
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
    userCount: room.users.length,
    timer: room.timer || 0
  }));
  io.emit('roomsUpdated', roomsWithUserCount);
}

io.on('connection', (socket) => {
  console.log('用户连接:', socket.id);
  
  socket.on('join', (userData) => {
    console.log('收到join事件，用户:', userData.username, 'ID:', userData.id, 'peerId:', userData.peerId);
    
    // 检查用户是否在断开连接列表中（可能是刷新页面）
    if (disconnectedUsers.has(userData.id)) {
      console.log('用户', userData.username, '正在重新连接（刷新页面），取消断开连接定时器');
      const userInfo = disconnectedUsers.get(userData.id);
      // 取消定时器
      clearTimeout(userInfo.timer);
      // 从断开连接列表中移除
      disconnectedUsers.delete(userData.id);
      console.log('用户', userData.username, '已从断开连接列表中移除，保持在原房间');
      
      // 检查用户之前所在的房间
      let previousRoom = null;
      let userPreviousStatus = 'idle';
      data.rooms.forEach(room => {
        const userInRoom = room.users.find(u => u.id === userData.id);
        if (userInRoom) {
          previousRoom = room;
          userPreviousStatus = userInRoom.status;
          console.log('用户之前在房间:', room.name, '状态:', userPreviousStatus);
          // 更新用户的peerId
          userInRoom.peerId = userData.peerId || '';
        }
      });
      
      // 更新在线用户信息
      onlineUsers.set(socket.id, { ...userData, socketId: socket.id, currentRoom: previousRoom ? previousRoom.id : null });
      console.log('用户已添加到onlineUsers，当前房间:', previousRoom ? previousRoom.id : null);
      
      // 如果用户之前在某个房间，加入该房间的socket房间
      if (previousRoom) {
        socket.join(previousRoom.id);
        console.log('用户已加入socket房间:', previousRoom.id);
        // 广播房间成员更新，确保包含更新后的peerId
        io.to(previousRoom.id).emit('roomUsersUpdated', previousRoom.users);
      }
    } else {
      // 新用户或首次连接
      onlineUsers.set(socket.id, { ...userData, socketId: socket.id, currentRoom: null });
      console.log('用户已添加到onlineUsers');
    }
    
    // 设置用户在线状态
    const userInData = data.users.find(u => u.id === userData.id);
    if (userInData) {
      console.log('找到用户数据，设置为在线');
      userInData.online = true;
      // 记录用户的peerId（如果有）
      if (userData.peerId) {
        userInData.peerId = userData.peerId;
        console.log('更新用户peerId:', userData.peerId);
      }
      saveData(data);
      console.log('数据已保存');
      
      // 广播用户状态更新
      console.log('广播user_status_updated事件，用户:', userData.username, '状态: 在线');
      io.emit('user_status_updated', {
        id: userData.id,
        username: userData.username,
        role: userData.role,
        online: true,
        peerId: userData.peerId
      });
      console.log('事件已广播');
    } else {
      console.log('未找到用户数据:', userData.id);
    }
    
    broadcastRooms();
    console.log('join事件处理完成');
  });
  
  socket.on('enterRoom', ({ roomId, user }) => {
    console.log('收到enterRoom事件，用户:', user.username, 'ID:', user.id, '目标房间:', roomId);
    
    const room = data.rooms.find(r => r.id === roomId);
    if (!room) {
      console.log('房间不存在:', roomId);
      return;
    }
    
    const currentUser = onlineUsers.get(socket.id);
    
    // 检查用户是否已经在目标房间中
    const userInTargetRoom = room.users.find(u => u.id === user.id);
    
    if (userInTargetRoom) {
      // 用户已经在目标房间中，只更新peerId
      console.log('用户', user.username, '已经在房间', room.name, '中，更新peerId');
      userInTargetRoom.peerId = user.peerId || '';
    } else {
      // 记录用户之前所在的房间
      let previousRoomId = null;
      data.rooms.forEach(r => {
        if (r.users.find(u => u.id === user.id)) {
          previousRoomId = r.id;
        }
      });
      
      console.log('用户之前所在房间:', previousRoomId);
      
      // 先从所有房间中移除该用户（确保不会同时出现在多个房间）
      data.rooms.forEach(r => {
        const userIndex = r.users.findIndex(u => u.id === user.id);
        if (userIndex !== -1) {
          console.log('从房间', r.name, '移除用户', user.username);
          r.users.splice(userIndex, 1);
          if (r.users.length === 0 && !r.isDefault) {
            r.status = 'idle';
          }
          console.log('房间', r.name, '现在有', r.users.length, '人');
          // 通知原房间内的其他用户
          io.to(r.id).emit('roomUsersUpdated', r.users);
        }
      });
      
      // 将用户添加到新房间
      // 新用户的初始状态应该等于房间的当前状态
      // 只有房间当前是空闲时，新用户才设为空闲
      const initialStatus = room.status !== 'idle' ? room.status : (user.status || 'idle');
      
      // 确保用户对象包含status和peerId属性
      const userWithStatus = { 
        ...user, 
        status: initialStatus,
        peerId: user.peerId || ''
      };
      console.log('将用户', user.username, '添加到房间', room.name, '，初始状态:', initialStatus);
      console.log(`用户 ${user.id} 加入房间 ${roomId}`);
      room.users.push(userWithStatus);
      console.log('房间', room.name, '现在有', room.users.length, '人');
    }
    
    if (currentUser) {
      currentUser.currentRoom = roomId;
      // 更新在线用户的peerId
      if (user.peerId) {
        currentUser.peerId = user.peerId;
      }
    }
    socket.join(roomId);
    
    // 更新所有房间中该用户的peerId
    data.rooms.forEach(r => {
      const userInRoom = r.users.find(u => u.id === user.id);
      if (userInRoom && user.peerId) {
        userInRoom.peerId = user.peerId;
      }
    });
    
    saveData(data);
    broadcastRooms();
    
    // 广播更新后的成员列表给房间内所有人，确保包含peerId
    console.log('广播房间成员列表，房间:', room.name, '成员数:', room.users.length);
    console.log('成员列表:', room.users.map(u => ({ name: u.username, peerId: u.peerId })));
    console.log(`广播成员更新，房间 ${roomId}，成员列表：${room.users.map(u => u.id).join(', ')}`);
    io.to(roomId).emit('roomUsersUpdated', room.users);
  });
  
  socket.on('leaveRoom', ({ roomId, user }) => {
    console.log('收到leaveRoom事件，用户:', user.username, 'ID:', user.id, '离开房间:', roomId);
    console.log(`用户 ${user.id} 离开房间 ${roomId}`);
    
    const room = data.rooms.find(r => r.id === roomId);
    if (!room) {
      console.log('房间不存在:', roomId);
      return;
    }
    
    console.log('离开房间前，房间', room.name, '有', room.users.length, '人');
    console.log('离开前成员列表:', room.users.map(u => u.username));
    
    room.users = room.users.filter(u => u.id !== user.id);
    
    console.log('离开房间后，房间', room.name, '有', room.users.length, '人');
    console.log('离开后成员列表:', room.users.map(u => u.username));
    
    if (room.users.length === 0 && !room.isDefault) {
      room.status = 'idle';
      console.log('房间', room.name, '现在为空，设置状态为idle');
    } else if (room.users.length > 0 && !room.isDefault) {
      // 房间状态已经由用户通过 changeRoomStatus 设置
      // 保持当前状态不变
      console.log('房间', room.name, '当前状态:', room.status);
    }
    
    const currentUser = onlineUsers.get(socket.id);
    if (currentUser) {
      currentUser.currentRoom = null;
      console.log('更新在线用户', user.username, '的当前房间为null');
    }
    
    socket.leave(roomId);
    console.log('用户', user.username, '已离开房间', room.name);
    
    saveData(data);
    broadcastRooms();
    io.to(roomId).emit('roomUsersUpdated', room.users);
    console.log('广播房间', room.name, '的成员列表更新');
    
    // 广播用户离开消息
    io.emit('user_left', {
      userId: user.id,
      username: user.username,
      roomId: roomId
    });
    console.log('广播user_left事件');
  });
  
  socket.on('changeRoomStatus', ({ roomId, status, user }) => {
    console.log('收到changeRoomStatus事件，房间ID:', roomId, '新状态:', status, '用户:', user.username);
    const room = data.rooms.find(r => r.id === roomId);
    if (!room) {
      console.log('房间不存在:', roomId);
      return;
    }
    
    console.log('更新前房间状态:', room.status, '计时器:', room.timer);
    room.status = status;
    console.log('更新后房间状态:', room.status);
    console.log('房间 ' + roomId + ' 状态变为：' + status);
    
    // 当任意用户点击状态按钮时，更新房间内所有在线用户的状态
    room.users.forEach(userInRoom => {
      userInRoom.status = status;
      console.log('更新用户状态:', userInRoom.username, '新状态:', status);
    });
    
    // 管理房间计时器
    if (!room.isDefault) {
      if (status === 'matching' || status === 'gaming') {
        // 开始或重置计时器
        room.timer = 0;
        console.log('开始或重置计时器，房间ID:', roomId, '状态:', status);
        startRoomTimer(roomId);
      } else {
        // 停止计时器
        console.log('停止计时器，房间ID:', roomId, '状态:', status);
        stopRoomTimer(roomId);
        room.timer = 0;
      }
    }
    
    saveData(data);
    console.log('数据已保存');
    
    broadcastRooms();
    console.log('已广播房间列表更新');
    // 通知房间内的其他用户
    io.to(roomId).emit('roomUsersUpdated', room.users);
    console.log('已通知房间内其他用户');
  });
  
  socket.on('send_message', (message) => {
    console.log('收到消息:', message);
    // 广播消息到房间内的所有用户
    io.to(message.roomId).emit('new_message', message);
  });

  socket.on('update-peer-id', ({ userId, peerId }) => {
    console.log('收到update-peer-id事件，用户ID:', userId, 'peerId:', peerId);
    // 更新用户数据中的peerId
    const userInData = data.users.find(u => u.id === userId);
    if (userInData) {
      userInData.peerId = peerId;
      saveData(data);
    }
    // 同时更新在线用户中的peerId
    onlineUsers.forEach((onlineUser, socketId) => {
      if (onlineUser.id === userId) {
        onlineUser.peerId = peerId;
      }
    });
    // 更新所有房间中该用户的peerId
    data.rooms.forEach(room => {
      const userInRoom = room.users.find(u => u.id === userId);
      if (userInRoom) {
        userInRoom.peerId = peerId;
      }
    });
    saveData(data);
    // 广播房间成员更新，确保包含peerId
    broadcastRooms();
  });

  socket.on('disconnect', () => {
    console.log('检测到用户断开连接，socket.id:', socket.id);
    const user = onlineUsers.get(socket.id);
    if (user) {
      console.log('断开连接的用户:', user.username, 'ID:', user.id);
      
      // 检查用户是否在断开连接列表中
      if (disconnectedUsers.has(user.id)) {
        console.log('用户', user.username, '已经在断开连接列表中，更新定时器');
        const userInfo = disconnectedUsers.get(user.id);
        // 取消旧定时器
        clearTimeout(userInfo.timer);
      }
      
      // 启动延迟定时器，3秒后再处理断开连接
      const timer = setTimeout(() => {
        console.log('用户', user.username, '断开连接超过3秒，从房间移除');
        
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
            
            // 重新计算房间状态，只由当前房间内的成员状态决定
            if (!room.isDefault) {
              if (room.users.length === 0) {
                // 房间成员为空，将房间状态设为 idle，计时器归零
                console.log('房间', room.name, '现在为空，设置状态为 idle');
                room.status = 'idle';
                room.timer = 0;
                // 停止计时器
                stopRoomTimer(room.id);
              } else {
                // 房间还有其他成员，按成员状态重新计算（优先级：匹配中 > 游戏中 > 空闲）
                console.log('房间', room.name, '还有', room.users.length, '个成员，重新计算状态');
                
                // 检查是否有成员处于 matching 状态
                const hasMatching = room.users.some(u => u.status === 'matching');
                // 检查是否有成员处于 gaming 状态
                const hasGaming = room.users.some(u => u.status === 'gaming');
                
                const oldStatus = room.status;
                
                if (hasMatching) {
                  // 有成员处于 matching 状态，房间状态设为 matching
                  room.status = 'matching';
                  console.log('房间', room.name, '状态设为 matching');
                } else if (hasGaming) {
                  // 有成员处于 gaming 状态，房间状态设为 gaming
                  room.status = 'gaming';
                  console.log('房间', room.name, '状态设为 gaming');
                } else {
                  // 所有成员都处于 idle 状态，房间状态设为 idle
                  room.status = 'idle';
                  room.timer = 0;
                  // 停止计时器
                  stopRoomTimer(room.id);
                  console.log('房间', room.name, '状态设为 idle');
                }
                
                // 如果状态发生变化，管理计时器
                if (room.status !== oldStatus) {
                  if (room.status === 'matching' || room.status === 'gaming') {
                    // 开始或重置计时器
                    room.timer = 0;
                    console.log('开始或重置计时器，房间ID:', room.id, '状态:', room.status);
                    startRoomTimer(room.id);
                  } else {
                    // 停止计时器
                    console.log('停止计时器，房间ID:', room.id, '状态:', room.status);
                    stopRoomTimer(room.id);
                    room.timer = 0;
                  }
                }
              }
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
        
        // 从断开连接列表中移除
        disconnectedUsers.delete(user.id);
        console.log('用户', user.username, '已从断开连接列表中移除，断开连接处理完成');
      }, DISCONNECT_DELAY);
      
      // 将用户添加到断开连接列表
      disconnectedUsers.set(user.id, {
        user,
        timer
      });
      console.log('用户', user.username, '已添加到断开连接列表，等待', DISCONNECT_DELAY, '毫秒');
    }
    onlineUsers.delete(socket.id);
    console.log('用户断开连接处理完成（延迟处理）:', socket.id);
  });
});

const PORT = process.env.PORT || 3001;
server.listen(PORT, () => {
  console.log(`服务器运行在端口 ${PORT}`);
});
