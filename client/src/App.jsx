import { useState, useEffect, useCallback } from 'react'
import io from 'socket.io-client'
import './App.css'

const API_URL = 'http://localhost:3001'

const statusColors = {
  matching: '#ea4335',
  gaming: '#34a853',
  idle: '#1a73e8',
  default: '#eef2f6'
}

const statusLabels = {
  matching: '匹配中',
  gaming: '游戏中',
  idle: '空闲'
}

function App() {
  const [socket, setSocket] = useState(null)
  const [user, setUser] = useState(null)
  const [rooms, setRooms] = useState([])
  const [users, setUsers] = useState([])
  const [currentRoom, setCurrentRoom] = useState(null)
  const [roomUsers, setRoomUsers] = useState([])
  const [loginForm, setLoginForm] = useState({ username: '', password: '' })
  const [newRoomName, setNewRoomName] = useState('')
  const [newUserName, setNewUserName] = useState('')
  const [showAddUser, setShowAddUser] = useState(false)
  const [showDeleteRoom, setShowDeleteRoom] = useState(false)
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false)
  const [showDeleteUserConfirm, setShowDeleteUserConfirm] = useState(false)
  const [roomToDelete, setRoomToDelete] = useState(null)
  const [userToDelete, setUserToDelete] = useState(null)
  const [isMobile, setIsMobile] = useState(false)
  const [error, setError] = useState('')

  useEffect(() => {
    const checkMobile = () => {
      setIsMobile(window.matchMedia('(pointer: coarse)').matches)
    }
    checkMobile()
    window.addEventListener('resize', checkMobile)
    return () => window.removeEventListener('resize', checkMobile)
  }, [])

  useEffect(() => {
    // 从sessionStorage加载用户信息
    const storedUser = sessionStorage.getItem('user')
    if (storedUser) {
      const parsedUser = JSON.parse(storedUser)
      setUser(parsedUser)
      fetchUsers()
    }
  }, [])

  useEffect(() => {
    if (user) {
      // 保存用户信息到sessionStorage
      sessionStorage.setItem('user', JSON.stringify(user))
      
      console.log('准备创建WebSocket连接，API_URL:', API_URL)
      const newSocket = io(API_URL, {
        transports: ['websocket'],
        reconnection: false
      })
      console.log('WebSocket实例已创建:', newSocket)
      setSocket(newSocket)

      newSocket.on('connect', () => {
        console.log('WebSocket连接已建立，socket.id:', newSocket.id)
        console.log('准备发送join事件:', user)
        newSocket.emit('join', user)
        console.log('join事件已发送')
        
        // 尝试从sessionStorage中恢复房间状态
        const savedRoom = sessionStorage.getItem('currentRoom')
        if (savedRoom) {
          try {
            const parsedRoom = JSON.parse(savedRoom)
            console.log('尝试恢复房间状态:', parsedRoom)
            // 直接尝试加入房间
            newSocket.emit('enterRoom', { roomId: parsedRoom.id, user })
            setCurrentRoom(parsedRoom)
          } catch (error) {
            console.error('恢复房间状态失败:', error)
            sessionStorage.removeItem('currentRoom')
          }
        }
      })

      newSocket.on('connect_error', (error) => {
        console.error('WebSocket连接错误:', error)
      })

      newSocket.on('disconnect', (reason) => {
        console.log('WebSocket连接已断开，原因:', reason)
      })

      newSocket.on('roomsUpdated', (updatedRooms) => {
        setRooms(updatedRooms)
      })

      newSocket.on('roomUsersUpdated', (users) => {
        setRoomUsers(users)
      })

      // 监听用户添加成功事件
      newSocket.on('user_added', (data) => {
        console.log('收到user_added事件:', data)
        console.log('准备调用fetchUsers()')
        fetchUsers()
      })

      // 监听房间删除事件
      newSocket.on('room_deleted', (data) => {
        console.log('收到room_deleted事件:', data)
        fetchRooms()
        // 如果当前在被删除的房间中，退出该房间
        if (currentRoom && currentRoom.id === data.roomId) {
          setCurrentRoom(null)
          setRoomUsers([])
        }
      })

      // 监听用户更新事件
      newSocket.on('user_updated', (data) => {
        console.log('收到user_updated事件:', data)
        fetchUsers()
      })

      // 监听用户删除事件
      newSocket.on('user_deleted', (data) => {
        console.log('收到user_deleted事件:', data)
        fetchUsers()
      })

      // 监听用户状态更新事件
      newSocket.on('user_status_updated', (updatedUser) => {
        console.log('收到user_status_updated事件:', updatedUser)
        setUsers(prevUsers => prevUsers.map(user => 
          user.id === updatedUser.id ? { ...user, online: updatedUser.online } : user
        ))
      })

      fetchRooms()

      return () => {
        // 不要主动关闭WebSocket连接，让浏览器自动处理
        // 这样服务器能正确检测到disconnect事件
      }
    }
  }, [user])

  const fetchRooms = async () => {
    try {
      const res = await fetch(`${API_URL}/api/rooms`)
      const data = await res.json()
      setRooms(data)
    } catch (err) {
      console.error('获取房间列表失败:', err)
    }
  }

  const fetchUsers = async () => {
    console.log('开始执行fetchUsers()')
    try {
      const res = await fetch(`${API_URL}/api/users`)
      const data = await res.json()
      console.log('获取用户列表成功:', data)
      setUsers(data)
    } catch (err) {
      console.error('获取用户列表失败:', err)
    }
  }

  const handleLogin = async (e) => {
    e.preventDefault()
    setError('')
    
    try {
      const res = await fetch(`${API_URL}/api/login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(loginForm)
      })
      const data = await res.json()
      
      if (data.success) {
        setUser(data.user)
        fetchUsers()
      } else {
        setError(data.message || '登录失败')
      }
    } catch (err) {
      setError('网络错误，请稍后重试')
    }
  }

  const handleCreateRoom = async (e) => {
    e.preventDefault()
    if (!newRoomName.trim()) return

    try {
      const res = await fetch(`${API_URL}/api/rooms`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: newRoomName, createdBy: user.id })
      })
      const data = await res.json()
      
      if (data.success) {
        setNewRoomName('')
      }
    } catch (err) {
      console.error('创建房间失败:', err)
    }
  }

  const handleAddUser = async (e) => {
    e.preventDefault()
    if (!newUserName.trim()) return

    try {
      const res = await fetch(`${API_URL}/api/users`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username: newUserName, createdBy: user.id })
      })
      const data = await res.json()
      
      if (data.success) {
        setNewUserName('')
        setShowAddUser(false)
        alert(`用户创建成功！用户名: ${data.user.username}, 密码: 123456`)
        fetchUsers()
      } else {
        alert(data.message || '创建用户失败')
      }
    } catch (err) {
      alert('网络错误，请稍后重试')
    }
  }

  const enterRoom = useCallback((room) => {
    if (!socket) return
    
    if (currentRoom) {
      socket.emit('leaveRoom', { roomId: currentRoom.id, user })
    }
    
    socket.emit('enterRoom', { roomId: room.id, user })
    setCurrentRoom(room)
    // 保存当前房间到sessionStorage
    sessionStorage.setItem('currentRoom', JSON.stringify(room))
  }, [socket, currentRoom, user])

  const leaveRoom = useCallback(() => {
    if (!socket || !currentRoom) return
    
    // 发送离开房间请求
    socket.emit('leaveRoom', { roomId: currentRoom.id, user })
    
    // 找到大厅房间
    const lobbyRoom = rooms.find(room => room.isDefault)
    if (lobbyRoom) {
      // 自动进入大厅
      enterRoom(lobbyRoom)
    } else {
      // 如果找不到大厅，清除房间状态
      setCurrentRoom(null)
      setRoomUsers([])
      // 清除sessionStorage中的房间信息
      sessionStorage.removeItem('currentRoom')
    }
  }, [socket, currentRoom, user, rooms, enterRoom])

  const changeRoomStatus = useCallback((status) => {
    if (!socket || !currentRoom) return
    
    socket.emit('changeRoomStatus', { roomId: currentRoom.id, status })
  }, [socket, currentRoom])

  const handleRoomClick = (room) => {
    if (isMobile) {
      enterRoom(room)
    }
  }

  const handleRoomDoubleClick = (room) => {
    if (!isMobile) {
      enterRoom(room)
    }
  }

  const handleDeleteRoom = (roomId, roomName) => {
    console.log('开始执行handleDeleteRoom，房间ID:', roomId, '房间名称:', roomName);
    setRoomToDelete({ id: roomId, name: roomName });
    setShowDeleteConfirm(true);
  }

  const confirmDeleteRoom = async () => {
    if (roomToDelete) {
      console.log('用户确认删除，准备发送请求，房间ID:', roomToDelete.id, '房间名称:', roomToDelete.name);
      try {
        const res = await fetch(`${API_URL}/api/rooms/${roomToDelete.id}`, {
          method: 'DELETE',
          headers: { 'Content-Type': 'application/json' }
        })
        const data = await res.json()
        console.log('删除请求结果:', data);
        if (!data.success) {
          alert(data.message || '删除房间失败')
        }
        setShowDeleteConfirm(false);
        setRoomToDelete(null);
        // 重置删除模式，使按钮变回「删除房间」
        setShowDeleteRoom(false);
      } catch (err) {
        console.error('删除房间失败:', err);
        alert('网络错误，请稍后重试');
        setShowDeleteConfirm(false);
        setRoomToDelete(null);
        // 重置删除模式，使按钮变回「删除房间」
        setShowDeleteRoom(false);
      }
    }
  }

  const cancelDeleteRoom = () => {
    console.log('用户取消删除');
    setShowDeleteConfirm(false);
    setRoomToDelete(null);
    // 重置删除模式，使按钮变回「删除房间」
    setShowDeleteRoom(false);
  }

  const handleSetAdmin = async (userId, username, newRole) => {
    try {
      const res = await fetch(`${API_URL}/api/users/${userId}/role`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ role: newRole })
      })
      const data = await res.json()
      if (data.success) {
        fetchUsers()
      } else {
        alert(data.message || '设置角色失败')
      }
    } catch (err) {
      alert('网络错误，请稍后重试')
    }
  }

  const handleDeleteUser = (userId, username) => {
    setUserToDelete({ id: userId, username: username });
    setShowDeleteUserConfirm(true);
  }

  const confirmDeleteUser = async () => {
    if (userToDelete) {
      try {
        const res = await fetch(`${API_URL}/api/users/${userToDelete.id}`, {
          method: 'DELETE',
          headers: { 'Content-Type': 'application/json' }
        })
        const data = await res.json()
        if (data.success) {
          fetchUsers()
        } else {
          alert(data.message || '删除用户失败')
        }
        setShowDeleteUserConfirm(false);
        setUserToDelete(null);
      } catch (err) {
        alert('网络错误，请稍后重试');
        setShowDeleteUserConfirm(false);
        setUserToDelete(null);
      }
    }
  }

  const cancelDeleteUser = () => {
    setShowDeleteUserConfirm(false);
    setUserToDelete(null);
  }

  const handleLogout = () => {
    if (socket) {
      socket.close()
    }
    // 清除sessionStorage中的用户信息和房间信息
    sessionStorage.removeItem('user')
    sessionStorage.removeItem('currentRoom')
    setUser(null)
    setSocket(null)
    setCurrentRoom(null)
    setRoomUsers([])
    setRooms([])
  }

  if (!user) {
    return (
      <div className="login-container">
        <div className="login-box">
          <h1>聊天室登录</h1>
          <form onSubmit={handleLogin}>
            <div className="form-group">
              <label>用户名</label>
              <input
                type="text"
                value={loginForm.username}
                onChange={(e) => setLoginForm({ ...loginForm, username: e.target.value })}
                placeholder="请输入用户名"
                required
              />
            </div>
            <div className="form-group">
              <label>密码</label>
              <input
                type="password"
                value={loginForm.password}
                onChange={(e) => setLoginForm({ ...loginForm, password: e.target.value })}
                placeholder="请输入密码"
                required
              />
            </div>
            {error && <div className="error">{error}</div>}
            <button type="submit" className="btn-primary">登录</button>
          </form>
          <div className="login-hint">
            <p>房主账号: 紫罗兰 / 152720</p>
          </div>
        </div>
      </div>
    )
  }

  return (
    <div className="app-container">
      <header className="app-header">
        <h1>聊天室</h1>
        <div className="user-info">
          <span>欢迎, {user.username} {user.role === 'owner' && '(房主)'}</span>
          <button className="btn-secondary" onClick={() => {
            console.log('手动关闭WebSocket连接');
            if (socket) {
              socket.close();
            }
          }}>测试断开</button>
          <button className="btn-secondary" onClick={handleLogout}>退出</button>
        </div>
      </header>

      {showAddUser && (
        <div className="modal-overlay" onClick={() => setShowAddUser(false)}>
          <div className="modal" onClick={(e) => e.stopPropagation()}>
            <h3>添加新用户</h3>
            <form onSubmit={handleAddUser}>
              <div className="form-group">
                <label>用户名</label>
                <input
                  type="text"
                  value={newUserName}
                  onChange={(e) => setNewUserName(e.target.value)}
                  placeholder="请输入用户名"
                  required
                />
              </div>
              <p className="hint">默认密码: 123456</p>
              <div className="modal-actions">
                <button type="button" className="btn-secondary" onClick={() => setShowAddUser(false)}>取消</button>
                <button type="submit" className="btn-primary">创建</button>
              </div>
            </form>
          </div>
        </div>
      )}

      {showDeleteConfirm && roomToDelete && (
        <div className="modal-overlay" onClick={cancelDeleteRoom}>
          <div className="modal" onClick={(e) => e.stopPropagation()}>
            <h3>删除房间</h3>
            <p>确定要删除房间 <strong>{roomToDelete.name}</strong> 吗？</p>
            <div className="modal-actions">
              <button type="button" className="btn-secondary" onClick={cancelDeleteRoom}>取消</button>
              <button type="button" className="btn-primary" onClick={confirmDeleteRoom}>确定</button>
            </div>
          </div>
        </div>
      )}

      {showDeleteUserConfirm && userToDelete && (
        <div className="modal-overlay" onClick={cancelDeleteUser}>
          <div className="modal" onClick={(e) => e.stopPropagation()}>
            <h3>删除用户</h3>
            <p>确定要删除用户 <strong>{userToDelete.username}</strong> 吗？</p>
            <div className="modal-actions">
              <button type="button" className="btn-secondary" onClick={cancelDeleteUser}>取消</button>
              <button type="button" className="btn-primary" onClick={confirmDeleteUser}>确定</button>
            </div>
          </div>
        </div>
      )}

      <main className="main-content">
        <div className="content-left">
          <div className="rooms-section">
            <div className="section-header">
            <h2>房间列表</h2>
            <div className="room-actions">
              <form onSubmit={handleCreateRoom} className="create-room-form">
                <input
                  type="text"
                  value={newRoomName}
                  onChange={(e) => setNewRoomName(e.target.value)}
                  placeholder="输入房间名称"
                />
                <button type="submit" className="btn-primary">创建房间</button>
              </form>
              {(user.role === 'owner' || user.role === 'admin') && (
                <button 
                  className="btn-secondary"
                  onClick={() => setShowDeleteRoom(!showDeleteRoom)}
                >
                  {showDeleteRoom ? '取消删除' : '删除房间'}
                </button>
              )}
            </div>
          </div>

            <div className="rooms-grid">
              {rooms.map((room) => (
                <div
                  key={room.id}
                  className={`room-card ${currentRoom?.id === room.id ? 'active' : ''}`}
                  style={{ backgroundColor: statusColors[room.status] || statusColors.default }}
                  onClick={() => handleRoomClick(room)}
                  onDoubleClick={() => handleRoomDoubleClick(room)}
                >
                  <div className="room-info">
                    <h3>{room.name}</h3>
                    <span className="room-status">{statusLabels[room.status] || '空闲'}</span>
                  </div>
                  <div className="room-users-count">
                    <span>{room.userCount || 0} 人在线</span>
                  </div>
                  {room.isDefault && <span className="default-badge">大厅</span>}
                  {showDeleteRoom && !room.isDefault && (user.role === 'owner' || user.role === 'admin') && (
                    <button 
                      className="delete-room-btn"
                      onClick={(e) => {
                        e.stopPropagation();
                        handleDeleteRoom(room.id, room.name);
                      }}
                      title="删除房间"
                    >
                      ×
                    </button>
                  )}
                </div>
              ))}
            </div>

            <p className="interaction-hint">
              {isMobile ? '点击房间进入' : '双击房间进入'}
            </p>
          </div>

          {currentRoom && (
            <div className="current-room-section">
              <div className="current-room-header">
                <h2>当前房间: {currentRoom.name}</h2>
                <button className="btn-secondary" onClick={leaveRoom}>离开房间</button>
              </div>

              <div className="room-status-controls">
                <span>房间状态:</span>
                <div className="status-buttons">
                  <button
                    className={`status-btn ${currentRoom.status === 'matching' ? 'active' : ''}`}
                    style={{ backgroundColor: statusColors.matching }}
                    onClick={() => changeRoomStatus('matching')}
                  >
                    匹配中
                  </button>
                  <button
                    className={`status-btn ${currentRoom.status === 'gaming' ? 'active' : ''}`}
                    style={{ backgroundColor: statusColors.gaming }}
                    onClick={() => changeRoomStatus('gaming')}
                  >
                    游戏中
                  </button>
                  <button
                    className={`status-btn ${currentRoom.status === 'idle' ? 'active' : ''}`}
                    style={{ backgroundColor: statusColors.idle }}
                    onClick={() => changeRoomStatus('idle')}
                  >
                    空闲
                  </button>
                </div>
              </div>

              <div className="room-users-list">
                <h3>在线用户 ({roomUsers.length})</h3>
                <ul>
                  {roomUsers.map((u) => (
                    <li key={u.id} className={u.id === user.id ? 'me' : ''}>
                      {u.username} {u.id === user.id && '(我)'}
                    </li>
                  ))}
                </ul>
              </div>
            </div>
          )}
        </div>

        <div className="content-right">
          <div className="members-section">
            <div className="members-header">
              <h2>成员管理</h2>
              {user.role === 'owner' && (
                <button 
                  className="btn-primary add-user-btn"
                  onClick={() => setShowAddUser(true)}
                >
                  + 添加用户
                </button>
              )}
            </div>
            <div className="members-list">
              <h3>所有用户 ({users.length})</h3>
              <ul>
                {users.map((u) => (
                  <li key={u.id} className={u.id === user.id ? 'me' : ''}>
                    <div className="member-info">
                      <span className="member-username">{u.username}</span>
                      <span className={`member-status ${u.online ? 'online' : 'offline'}`}>
                        {u.online ? '在线' : '离线'}
                      </span>
                    </div>
                    <div className="member-actions">
                      {(u.role === 'owner' || u.role === 'admin') && (
                        <span className={`member-role ${u.role}`}>
                          {u.role === 'owner' ? '房主' : '管理员'}
                        </span>
                      )}
                      {user.role === 'owner' && u.role !== 'owner' && (
                        <div className="member-buttons">
                          <button 
                            className="btn-secondary small"
                            onClick={() => handleSetAdmin(u.id, u.username, u.role === 'admin' ? 'user' : 'admin')}
                          >
                            {u.role === 'admin' ? '取消管理员' : '设为管理员'}
                          </button>
                          <button 
                            className="btn-secondary small danger"
                            onClick={() => handleDeleteUser(u.id, u.username)}
                          >
                            删除
                          </button>
                        </div>
                      )}
                    </div>
                  </li>
                ))}
              </ul>
            </div>
          </div>
        </div>
      </main>
    </div>
  )
}

export default App
