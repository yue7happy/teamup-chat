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
    origin: "http://localhost:5173",
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
  
  // 不允许删除默认大厅
  if (id === 'lobby') {
    return res.json({ success: false, message: '无法删除默认大厅' });
  }
  
  const roomIndex = data.rooms.findIndex(room => room.id === id);
  if (roomIndex === -1) {
    return res.json({ success: false, message: '房间不存在' });
  }
  
  const deletedRoom = data.rooms[roomIndex];
  data.rooms.splice(roomIndex, 1);
  saveData(data);
  
  // 广播房间删除消息
  io.emit('room_deleted', { success: true, roomId: id });
  
  res.json({ success: true, message: '房间删除成功' });
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
    onlineUsers.set(socket.id, { ...userData, socketId: socket.id, currentRoom: null });
    broadcastRooms();
  });
  
  socket.on('enterRoom', ({ roomId, user }) => {
    const room = data.rooms.find(r => r.id === roomId);
    if (!room) return;
    
    const currentUser = onlineUsers.get(socket.id);
    if (currentUser && currentUser.currentRoom) {
      const oldRoom = data.rooms.find(r => r.id === currentUser.currentRoom);
      if (oldRoom) {
        oldRoom.users = oldRoom.users.filter(u => u.id !== user.id);
        if (oldRoom.users.length === 0 && !oldRoom.isDefault) {
          oldRoom.status = 'idle';
        }
      }
    }
    
    if (!room.users.find(u => u.id === user.id)) {
      room.users.push(user);
    }
    
    currentUser.currentRoom = roomId;
    socket.join(roomId);
    
    broadcastRooms();
    io.to(roomId).emit('roomUsersUpdated', room.users);
  });
  
  socket.on('leaveRoom', ({ roomId, user }) => {
    const room = data.rooms.find(r => r.id === roomId);
    if (!room) return;
    
    room.users = room.users.filter(u => u.id !== user.id);
    
    if (room.users.length === 0 && !room.isDefault) {
      room.status = 'idle';
    }
    
    const currentUser = onlineUsers.get(socket.id);
    if (currentUser) {
      currentUser.currentRoom = null;
    }
    
    socket.leave(roomId);
    
    saveData(data);
    broadcastRooms();
    io.to(roomId).emit('roomUsersUpdated', room.users);
  });
  
  socket.on('changeRoomStatus', ({ roomId, status }) => {
    const room = data.rooms.find(r => r.id === roomId);
    if (!room) return;
    
    room.status = status;
    saveData(data);
    
    broadcastRooms();
  });
  
  socket.on('disconnect', () => {
    const user = onlineUsers.get(socket.id);
    if (user) {
      // 设置用户离线状态
      const userInData = data.users.find(u => u.id === user.id);
      if (userInData) {
        userInData.online = false;
        saveData(data);
        
        // 广播用户状态更新
        io.emit('user_status_updated', {
          id: user.id,
          username: user.username,
          role: user.role,
          online: false
        });
      }
      
      // 处理房间退出
      if (user.currentRoom) {
        const room = data.rooms.find(r => r.id === user.currentRoom);
        if (room) {
          room.users = room.users.filter(u => u.id !== user.id);
          if (room.users.length === 0 && !room.isDefault) {
            room.status = 'idle';
          }
          saveData(data);
          broadcastRooms();
          io.to(user.currentRoom).emit('roomUsersUpdated', room.users);
        }
      }
    }
    onlineUsers.delete(socket.id);
    console.log('用户断开连接:', socket.id);
  });
});

const PORT = process.env.PORT || 3001;
server.listen(PORT, () => {
  console.log(`服务器运行在端口 ${PORT}`);
});
