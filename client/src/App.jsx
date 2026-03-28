import { useState, useEffect, useCallback, useRef } from 'react'
import io from 'socket.io-client'
import './App.css'

const API_URL = 'http://localhost:3001'

const statusColors = {
  matching: '#ea4335',
  gaming: '#34a853',
  idle: '#1a73e8',
  default: '#eef2f6',
  lobby: '#333333'
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
  const [messages, setMessages] = useState([])
  const [messageInput, setMessageInput] = useState('')
  const [peer, setPeer] = useState(null)
  const [peerId, setPeerId] = useState(null)
  const [localStream, setLocalStream] = useState(null)
  const [isMicOn, setIsMicOn] = useState(false)
  const [isDeafen, setIsDeafen] = useState(false)
  const [connections, setConnections] = useState({})
  const [remoteAudios, setRemoteAudios] = useState({})
  const hasRestoredMicRef = useRef(false)
  const localStreamRef = useRef(null)

  useEffect(() => {
    const checkMobile = () => {
      setIsMobile(window.matchMedia('(pointer: coarse)').matches)
    }
    checkMobile()
    window.addEventListener('resize', checkMobile)
    return () => window.removeEventListener('resize', checkMobile)
  }, [])

  // 页面开始加载时
  console.log('开始加载', Date.now())

  // 初始化时间戳
  const startTime = performance.now()

  // 立即从sessionStorage读取状态
  useEffect(() => {
    console.log(`[${performance.now() - startTime}ms] 开始初始化应用`)
    
    // 立即从sessionStorage读取上次的房间和开麦状态
    const storedUser = sessionStorage.getItem('user')
    const storedRoom = sessionStorage.getItem('currentRoom')
    const storedMicState = sessionStorage.getItem('isMicOn')
    
    console.log(`[${performance.now() - startTime}ms] 从sessionStorage读取状态完成`)
    
    if (storedUser) {
      const parsedUser = JSON.parse(storedUser)
      setUser(parsedUser)
      console.log(`[${performance.now() - startTime}ms] 用户状态已恢复`)
    }
    
    if (storedRoom) {
      try {
        const parsedRoom = JSON.parse(storedRoom)
        setCurrentRoom(parsedRoom)
        console.log(`[${performance.now() - startTime}ms] 房间状态已恢复`)
        console.log('房间状态恢复完成', Date.now())
      } catch (error) {
        console.error('恢复房间状态失败:', error)
      }
    }
    
    // 检查是否已经有 Peer 实例
    if (!window.peer) {
      // 初始化 PeerJS，使用默认配置
      console.log(`[${performance.now() - startTime}ms] 开始初始化 PeerJS`)
      
      // 使用默认配置，让 PeerJS 自动选择服务器
      const peerInitStartTime = performance.now()
      const newPeer = new Peer()
      
      newPeer.on('open', (id) => {
        const connectTime = performance.now() - peerInitStartTime
        console.log(`[${performance.now() - startTime}ms] PeerJS 初始化成功，耗时: ${connectTime.toFixed(2)}ms, ID:`, id)
        console.log('PeerJS 初始化成功', Date.now())
        
        setPeerId(id)
        window.currentPeerId = id
        setPeer(newPeer)
        window.peer = newPeer
      })
      
      newPeer.on('error', (error) => {
        console.error(`[${performance.now() - startTime}ms] PeerJS 初始化错误:`, error)
        // 尝试使用备用配置
        console.log('尝试使用备用配置...')
        const fallbackPeer = new Peer(undefined, {
          host: '0.peerjs.com',
          port: 443,
          path: '/',
          secure: true
        })
        fallbackPeer.on('open', (id) => {
          console.log(`[${performance.now() - startTime}ms] 备用配置 PeerJS 初始化成功，ID:`, id)
          setPeerId(id)
          window.currentPeerId = id
          setPeer(fallbackPeer)
          window.peer = fallbackPeer
        })
      })
      
      // 设置呼叫处理
      newPeer.on('call', (call) => {
        console.log('收到呼叫，来自：', call.peer)
        // 无论本地是否有流，都要应答
        // 使用 ref 获取最新的 localStream
        const currentStream = localStreamRef.current
        if (currentStream) {
          call.answer(currentStream)
        } else {
          call.answer()
        }
        // 监听远程流并播放
        call.on('stream', (remoteStream) => {
          console.log('收到远程流，来自：', call.peer)
          const audio = new Audio()
          audio.srcObject = remoteStream
          audio.play()
          console.log('开始播放对方声音')
          // 保存音频元素引用
          setRemoteAudios(prev => ({ ...prev, [call.peer]: audio }))
        })
      })
    } else {
      console.log(`[${performance.now() - startTime}ms] PeerJS 实例已存在，复用现有实例`)
      if (window.currentPeerId) {
        setPeerId(window.currentPeerId)
        console.log('PeerJS 初始化成功', Date.now())
      }
    }
    
    // 并行获取用户列表和房间列表
    Promise.all([
      // 获取用户列表
      fetch(`${API_URL}/api/users`)
        .then(res => res.json())
        .then(data => {
          console.log(`[${performance.now() - startTime}ms] 获取用户列表成功:`, data)
          setUsers(data)
          console.log('用户列表加载完成', Date.now())
        })
        .catch(err => {
          console.error('获取用户列表失败:', err)
        }),
      
      // 获取房间列表
      fetch(`${API_URL}/api/rooms`)
        .then(res => res.json())
        .then(data => {
          console.log(`[${performance.now() - startTime}ms] 获取房间列表成功:`, data)
          setRooms(data)
        })
        .catch(err => {
          console.error('获取房间列表失败:', err)
        })
    ]).then(() => {
      console.log(`[${performance.now() - startTime}ms] 所有初始化操作完成`)
    })
    
    return () => {
      // 清理资源
    }
  }, [])

  // WebSocket 连接和事件处理
  useEffect(() => {
    if (user) {
      console.log(`[${performance.now() - startTime}ms] 开始建立 WebSocket 连接`)
      
      // 保存用户信息到sessionStorage
      sessionStorage.setItem('user', JSON.stringify(user))
      
      const newSocket = io(API_URL, {
        transports: ['websocket'],
        reconnection: false
      })
      console.log(`[${performance.now() - startTime}ms] WebSocket 实例已创建`)
      setSocket(newSocket)

      newSocket.on('connect', () => {
        console.log(`[${performance.now() - startTime}ms] WebSocket 连接已建立，socket.id:`, newSocket.id)
        console.log('WebSocket 连接成功', Date.now())
        // 发送 join 事件时包含 peerId
        const userWithPeerId = { ...user, peerId: peerId }
        console.log('准备发送join事件:', userWithPeerId)
        newSocket.emit('join', userWithPeerId)
        console.log('join事件已发送')
        
        // 如果已经有 peerId，发送 update-peer-id 事件
        if (peerId) {
          console.log('WebSocket连接建立，发送 update-peer-id 事件，用户ID:', user.id, 'peerId:', peerId)
          newSocket.emit('update-peer-id', { userId: user.id, peerId: peerId })
        }
        
        // 尝试从sessionStorage中恢复房间状态
        const savedRoom = sessionStorage.getItem('currentRoom')
        if (savedRoom) {
          try {
            const parsedRoom = JSON.parse(savedRoom)
            console.log('尝试恢复房间状态:', parsedRoom)
            // 检查房间是否仍然存在
            fetch(`${API_URL}/api/rooms`)
              .then(res => res.json())
              .then(updatedRooms => {
                const roomExists = updatedRooms.find(r => r.id === parsedRoom.id)
                if (roomExists) {
                  // 延迟进入房间，确保 peerId 已经获取
                  const enterRoomWithDelay = () => {
                    const currentPeerId = window.currentPeerId || peerId
                    if (currentPeerId) {
                      const userWithPeerId = { ...user, peerId: currentPeerId }
                      console.log('发送 enterRoom 事件（恢复房间）:', { roomId: parsedRoom.id, user: userWithPeerId })
                      newSocket.emit('enterRoom', { roomId: parsedRoom.id, user: userWithPeerId })
                      // 同时发送 update-peer-id 确保 peerId 已更新
                      newSocket.emit('update-peer-id', { userId: user.id, peerId: currentPeerId })
                    } else {
                      // 如果还没有 peerId，延迟重试
                      console.log('等待 peerId 获取...')
                      setTimeout(enterRoomWithDelay, 500)
                      return
                    }
                  }
                  enterRoomWithDelay()
                } else {
                  // 房间不存在了，进入大厅
                  const lobbyRoom = updatedRooms.find(room => room.isDefault)
                  if (lobbyRoom) {
                    newSocket.emit('enterRoom', { roomId: lobbyRoom.id, user })
                    setCurrentRoom(lobbyRoom)
                    sessionStorage.setItem('currentRoom', JSON.stringify(lobbyRoom))
                  }
                }
              })
          } catch (error) {
            console.error('恢复房间状态失败:', error)
            sessionStorage.removeItem('currentRoom')
          }
        } else {
          // 没有保存的房间状态，进入默认大厅
          fetch(`${API_URL}/api/rooms`)
            .then(res => res.json())
            .then(updatedRooms => {
              const lobbyRoom = updatedRooms.find(room => room.isDefault)
              if (lobbyRoom) {
                console.log('自动进入默认大厅:', lobbyRoom)
                newSocket.emit('enterRoom', { roomId: lobbyRoom.id, user })
                setCurrentRoom(lobbyRoom)
                sessionStorage.setItem('currentRoom', JSON.stringify(lobbyRoom))
              }
            })
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
        console.log('收到房间成员更新:', users)
        setRoomUsers(users)
        // 同时更新当前房间的状态，确保状态同步
        if (currentRoom) {
          // 打印更新前的房间成员
          const roomBefore = rooms.find(r => r.id === currentRoom.id)
          if (roomBefore) {
            console.log('更新前的房间成员:', roomBefore.id, roomBefore.name, roomBefore.users ? roomBefore.users.map(u => u.username) : [])
          }
          
          fetch(`${API_URL}/api/rooms`)
            .then(res => res.json())
            .then(updatedRooms => {
              console.log('更新后的房间列表:', updatedRooms)
              setRooms(updatedRooms)
              const updatedRoom = updatedRooms.find(r => r.id === currentRoom.id)
              if (updatedRoom) {
                console.log('更新后的当前房间:', updatedRoom.id, updatedRoom.name, updatedRoom.users ? updatedRoom.users.map(u => u.username) : [])
                setCurrentRoom(updatedRoom)
                sessionStorage.setItem('currentRoom', JSON.stringify(updatedRoom))
              }
            })
        }
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
        console.log('当前房间:', currentRoom)
        // 重新获取房间列表
        fetch(`${API_URL}/api/rooms`)
          .then(res => res.json())
          .then(updatedRooms => {
            console.log('获取到的房间列表:', updatedRooms)
            setRooms(updatedRooms)
            // 只有当当前在被删除的房间中时，才切换到大厅
            if (currentRoom && currentRoom.id === data.roomId) {
              // 找到默认大厅房间
              const lobbyRoom = updatedRooms.find(room => room.isDefault)
              console.log('找到的大厅:', lobbyRoom)
              if (lobbyRoom) {
                console.log('当前在被删除的房间中，自动进入大厅:', lobbyRoom)
                newSocket.emit('enterRoom', { roomId: lobbyRoom.id, user })
                console.log('设置当前房间为大厅')
                setCurrentRoom(lobbyRoom)
                // 保存大厅到sessionStorage
                sessionStorage.setItem('currentRoom', JSON.stringify(lobbyRoom))
                console.log('保存大厅到sessionStorage')
              }
            }
          })
          .catch(err => {
            console.error('获取房间列表失败:', err)
          })
      })

      // 监听用户移动事件
      newSocket.on('user_moved', (data) => {
        console.log('收到user_moved事件:', data)
        console.log('当前用户ID:', user?.id)
        // 只有当移动的是当前用户时，才更新界面
        if (data.userId === user?.id) {
          // 重新获取房间列表
          fetch(`${API_URL}/api/rooms`)
            .then(res => res.json())
            .then(updatedRooms => {
              console.log('获取到的房间列表:', updatedRooms)
              setRooms(updatedRooms)
              // 找到目标房间（大厅）
              const targetRoom = updatedRooms.find(room => room.id === data.toRoom)
              console.log('找到的目标房间:', targetRoom)
              if (targetRoom) {
                console.log('当前用户被移动到:', targetRoom.name)
                console.log('设置当前房间为目标房间')
                setCurrentRoom(targetRoom)
                // 保存到sessionStorage
                sessionStorage.setItem('currentRoom', JSON.stringify(targetRoom))
                console.log('保存目标房间到sessionStorage')
              }
            })
            .catch(err => {
              console.error('获取房间列表失败:', err)
            })
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

      // 监听用户离开消息
      newSocket.on('user_left', (data) => {
        console.log('收到user_left事件:', data)
        // 不再调用fetchRooms()，完全依赖roomUsersUpdated事件来更新状态
        // 这样可以避免用旧的房间列表覆盖新的状态
      })

      // 监听新消息
      newSocket.on('new_message', (message) => {
        console.log('收到新消息:', message)
        setMessages(prev => [...prev, message])
        // 自动滚动到底部
        setTimeout(() => {
          const chatMessages = document.querySelector('.chat-messages')
          if (chatMessages) {
            chatMessages.scrollTop = chatMessages.scrollHeight
          }
        }, 100)
      })

      return () => {
        // 不要主动关闭WebSocket连接，让浏览器自动处理
        // 这样服务器能正确检测到disconnect事件
      }
    }
  }, [user])

  // 恢复开麦状态 - 当用户进入房间后检查是否需要恢复开麦
  useEffect(() => {
    const restoreMicState = async () => {
      // 检查是否已经恢复过
      if (hasRestoredMicRef.current) return
      
      // 检查是否需要恢复开麦状态
      const savedMicState = sessionStorage.getItem('isMicOn')
      if (savedMicState !== 'true') return
      
      // 确保已经进入房间且不是大厅
      if (!currentRoom || currentRoom.isDefault) return
      
      // 确保已经有 peer 实例
      const currentPeer = window.peer || peer
      if (!currentPeer) return
      
      // 确保已经有 peerId
      if (!peerId) return
      
      // 标记已经尝试恢复
      hasRestoredMicRef.current = true
      
      console.log('检测到需要恢复开麦状态，正在恢复...')
      
      try {
        // 获取麦克风流
        const stream = await navigator.mediaDevices.getUserMedia({ audio: true })
        console.log('麦克风已获取（恢复状态）')
        setLocalStream(stream)
        // 同时更新 ref
        localStreamRef.current = stream
        
        // 遍历当前房间的所有其他成员，发起呼叫
        const newConnections = {}
        roomUsers.forEach(otherUser => {
          if (otherUser.peerId && otherUser.peerId !== peerId) {
            console.log('恢复状态：发起呼叫给：', otherUser.peerId)
            try {
              const call = currentPeer.call(otherUser.peerId, stream)
              newConnections[otherUser.peerId] = call
            } catch (error) {
              console.error('恢复状态：发起呼叫时出错:', error)
            }
          }
        })
        setConnections(newConnections)
        setIsMicOn(true)
        console.log('开麦状态已恢复')
        console.log('开麦状态恢复完成', Date.now())
      } catch (error) {
        console.error('恢复开麦状态失败:', error)
        // 恢复失败，清除保存的状态
        sessionStorage.removeItem('isMicOn')
        // 重置标记，允许下次尝试
        hasRestoredMicRef.current = false
      }
    }
    
    // 立即执行，不延迟
    restoreMicState()
  }, [currentRoom, peer, peerId, roomUsers])

  // 当房间成员变化时，如果有新成员加入且当前正在开麦，向新成员发起呼叫
  useEffect(() => {
    // 只有在开麦状态下才处理
    if (!isMicOn || !localStreamRef.current) return
    
    const currentPeer = window.peer || peer
    if (!currentPeer || !peerId) return
    
    // 延迟执行，确保新成员已经准备好接收呼叫
    const timer = setTimeout(() => {
      // 检查是否有新成员需要呼叫
      roomUsers.forEach(otherUser => {
        if (otherUser.peerId && otherUser.peerId !== peerId) {
          // 检查是否已经呼叫过
          if (!connections[otherUser.peerId]) {
            console.log('检测到新成员加入，发起呼叫给：', otherUser.peerId)
            try {
              const call = currentPeer.call(otherUser.peerId, localStreamRef.current)
              setConnections(prev => ({ ...prev, [otherUser.peerId]: call }))
            } catch (error) {
              console.error('向新成员发起呼叫时出错:', error)
            }
          }
        }
      })
    }, 1000) // 延迟 1 秒，确保新成员准备好
    
    return () => clearTimeout(timer)
  }, [roomUsers, isMicOn, peer, peerId, connections])

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
    
    // 如果当前在房间中，先清理语音连接
    if (currentRoom && currentRoom.id !== room.id) {
      console.log('切换房间，清理语音连接...')
      // 停止本地麦克风流
      if (localStream) {
        localStream.getTracks().forEach(track => track.stop())
        setLocalStream(null)
      }
      // 关闭所有 WebRTC 连接
      Object.values(connections).forEach(call => call.close())
      setConnections({})
      // 停止所有远程音频
      Object.values(remoteAudios).forEach(audio => {
        if (audio) {
          audio.pause()
          audio.srcObject = null
        }
      })
      setRemoteAudios({})
      // 重置开麦状态
      setIsMicOn(false)
      sessionStorage.removeItem('isMicOn')
      // 重置恢复标记
      hasRestoredMicRef.current = false
      
      socket.emit('leaveRoom', { roomId: currentRoom.id, user })
    }
    
    // 发送 enterRoom 事件时包含 peerId
    const userWithPeerId = { ...user, peerId: peerId }
    console.log('发送 enterRoom 事件:', { roomId: room.id, user: userWithPeerId })
    socket.emit('enterRoom', { roomId: room.id, user: userWithPeerId })
    setCurrentRoom(room)
    // 清空消息列表，只显示当前房间的消息
    setMessages([])
    // 保存当前房间到sessionStorage
    sessionStorage.setItem('currentRoom', JSON.stringify(room))
  }, [socket, currentRoom, user, peerId, localStream, connections, remoteAudios])

  const leaveRoom = useCallback(() => {
    if (!socket || !currentRoom) return
    
    // 发送离开房间请求
    socket.emit('leaveRoom', { roomId: currentRoom.id, user })
    
    // 如果正在开麦，先关闭麦克风
    if (localStream) {
      localStream.getTracks().forEach(track => track.stop())
      setLocalStream(null)
    }
    // 关闭所有连接
    Object.values(connections).forEach(call => call.close())
    setConnections({})
    setIsMicOn(false)
    // 清除开麦状态
    sessionStorage.removeItem('isMicOn')
    // 重置恢复标记
    hasRestoredMicRef.current = false
    
    // 找到大厅房间
    const lobbyRoom = rooms.find(room => room.isDefault)
    if (lobbyRoom) {
      // 自动进入大厅
      enterRoom(lobbyRoom)
    } else {
      // 如果找不到大厅，清除房间状态
      setCurrentRoom(null)
      setRoomUsers([])
      setMessages([])
      // 清除sessionStorage中的房间信息
      sessionStorage.removeItem('currentRoom')
    }
  }, [socket, currentRoom, user, rooms, enterRoom, localStream, connections])

  const changeRoomStatus = useCallback((status) => {
    if (!socket || !currentRoom) return
    
    // 立即更新本地状态，让按钮颜色立即变化
    const updatedRoom = { ...currentRoom, status }
    setCurrentRoom(updatedRoom)
    // 保存到sessionStorage
    sessionStorage.setItem('currentRoom', JSON.stringify(updatedRoom))
    
    // 发送到服务器，包含用户信息
    socket.emit('changeRoomStatus', { roomId: currentRoom.id, status, user })
  }, [socket, currentRoom, user])

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
    if (socket && currentRoom) {
      // 先发送离开房间请求
      socket.emit('leaveRoom', { roomId: currentRoom.id, user })
    }
    if (socket) {
      socket.close()
    }
    // 如果正在开麦，关闭麦克风
    if (localStream) {
      localStream.getTracks().forEach(track => track.stop())
    }
    // 关闭所有连接
    Object.values(connections).forEach(call => call.close())
    // 清除sessionStorage中的用户信息和房间信息
    sessionStorage.removeItem('user')
    sessionStorage.removeItem('currentRoom')
    sessionStorage.removeItem('isMicOn')
    setUser(null)
    setSocket(null)
    setCurrentRoom(null)
    setRoomUsers([])
    setRooms([])
    setMessages([])
    setLocalStream(null)
    setConnections({})
    setIsMicOn(false)
    hasRestoredMicRef.current = false
  }

  const sendMessage = useCallback(() => {
    if (!socket || !currentRoom || !messageInput.trim()) return
    
    const message = {
      roomId: currentRoom.id,
      userId: user.id,
      username: user.username,
      content: messageInput.trim(),
      timestamp: new Date().toLocaleTimeString()
    }
    
    socket.emit('send_message', message)
    setMessageInput('')
    
    // 自动滚动到底部
    setTimeout(() => {
      const chatMessages = document.querySelector('.chat-messages')
      if (chatMessages) {
        chatMessages.scrollTop = chatMessages.scrollHeight
      }
    }, 100)
  }, [socket, currentRoom, user, messageInput])

  // 开麦/闭麦功能
  const toggleMic = async () => {
    const currentPeer = window.peer || peer
    if (!currentPeer || !currentRoom || currentRoom.isDefault) return
    
    console.log('使用的 peer 实例：', currentPeer)
    console.log('window.peer 实例：', window.peer)
    console.log('state 中的 peer 实例：', peer)
    
    if (!isMicOn) {
      // 开麦
      console.log('正在打开麦克风...')
      try {
        // 获取麦克风流
        const stream = await navigator.mediaDevices.getUserMedia({ audio: true })
        console.log('麦克风已获取')
        setLocalStream(stream)
        // 同时更新 ref
        localStreamRef.current = stream
        
        // 遍历当前房间的所有其他成员，发起呼叫
        const newConnections = {}
        roomUsers.forEach(otherUser => {
          if (otherUser.peerId && otherUser.peerId !== peerId) {
            console.log('发起呼叫给：', otherUser.peerId)
            try {
              const call = currentPeer.call(otherUser.peerId, stream)
              newConnections[otherUser.peerId] = call
            } catch (error) {
              console.error('发起呼叫时出错:', error)
            }
          }
        })
        setConnections(newConnections)
        setIsMicOn(true)
        // 保存开麦状态到 sessionStorage
        sessionStorage.setItem('isMicOn', 'true')
        console.log('麦克风已打开，已向房间成员发起呼叫')
      } catch (error) {
        console.error('获取麦克风权限失败:', error)
        alert('无法获取麦克风权限，请检查浏览器设置')
      }
    } else {
      // 闭麦
      console.log('正在关闭麦克风...')
      // 停止音频流
      if (localStream) {
        localStream.getTracks().forEach(track => track.stop())
        setLocalStream(null)
        // 同时清除 ref
        localStreamRef.current = null
      }
      
      // 关闭所有连接
      Object.values(connections).forEach(call => call.close())
      setConnections({})
      setIsMicOn(false)
      // 清除开麦状态
      sessionStorage.removeItem('isMicOn')
      console.log('麦克风已关闭')
    }
  }

  // 闭听/开听功能
  const toggleDeafen = () => {
    if (!currentRoom || currentRoom.isDefault) return
    
    if (!isDeafen) {
      // 闭听 - 暂停所有远程音频
      console.log('正在闭听...')
      Object.values(remoteAudios).forEach(audio => {
        if (audio && !audio.paused) {
          audio.pause()
        }
      })
      setIsDeafen(true)
      console.log('已闭听，停止播放远程声音')
    } else {
      // 开听 - 恢复播放所有远程音频
      console.log('正在开听...')
      Object.values(remoteAudios).forEach(audio => {
        if (audio && audio.paused) {
          audio.play()
        }
      })
      setIsDeafen(false)
      console.log('已开听，恢复播放远程声音')
    }
  }

  // 测试呼叫功能
  const testCall = () => {
    const currentPeer = window.peer || peer
    if (!currentPeer || !currentRoom || currentRoom.isDefault) return
    
    console.log('使用的 peer 实例：', currentPeer)
    console.log('window.peer 实例：', window.peer)
    console.log('state 中的 peer 实例：', peer)
    
    // 从当前房间成员列表中获取另一个用户的 peerId
    const otherUser = roomUsers.find(user => user.peerId && user.peerId !== peerId)
    if (otherUser) {
      console.log('发起呼叫给：', otherUser.peerId)
      try {
        currentPeer.call(otherUser.peerId, null)
      } catch (error) {
        console.error('发起呼叫时出错:', error)
      }
    } else {
      console.log('当前房间没有其他在线用户')
    }
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
              {rooms.map((room) => {
                // 按房间状态计算颜色
                let roomColor = statusColors.default;
                if (room.isDefault) {
                  roomColor = statusColors.lobby;
                } else if (room.status === 'matching') {
                  roomColor = statusColors.matching; // 红色
                } else if (room.status === 'gaming') {
                  roomColor = statusColors.gaming; // 绿色
                } else {
                  roomColor = statusColors.idle; // 蓝色
                }
                
                // 打印房间成员信息
                console.log('渲染房间卡片:', room.id, room.name, '成员:', room.users ? room.users.map(u => u.username) : [], '人数:', room.userCount || 0)
                
                // 显示成员列表
                const renderMembers = (users) => {
                  if (!users || users.length === 0) return ''
                  if (users.length <= 3) {
                    return users.map(u => u.username).join('、')
                  } else {
                    return users.slice(0, 3).map(u => u.username).join('、') + `…+${users.length - 3}`
                  }
                }
                
                return (
                  <div
                    key={room.id}
                    className={`room-card ${currentRoom?.id === room.id ? 'active' : ''}`}
                    style={{ backgroundColor: roomColor }}
                    onClick={() => handleRoomClick(room)}
                    onDoubleClick={() => handleRoomDoubleClick(room)}
                  >
                    <div className="room-info">
                      <h3>{room.name}</h3>
                      <span className="room-status">{statusLabels[room.status] || '空闲'}</span>
                      {!room.isDefault && room.users && room.users.length > 0 && (
                        <div className="room-members">
                          {renderMembers(room.users)}
                        </div>
                      )}
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
                )
              })}
            </div>

            <p className="interaction-hint">
              {isMobile ? '点击房间进入' : '双击房间进入'}
            </p>
          </div>

          {currentRoom && (
            <div className="current-room-section">
              <div className="current-room-header">
                <div>
                  <h2>当前房间: {currentRoom.name}</h2>
                  {peerId && <div>我的 Peer ID: {peerId}</div>}
                </div>
                {!currentRoom.isDefault && (
                  <div className="voice-controls">
                    <button className="btn-secondary" onClick={toggleMic}>{isMicOn ? '闭麦' : '开麦'}</button>
                    <button className="btn-secondary" onClick={toggleDeafen}>{isDeafen ? '开听' : '闭听'}</button>
                    <button className="btn-secondary" onClick={testCall}>测试呼叫</button>
                  </div>
                )}
                <button className="btn-secondary" onClick={leaveRoom}>离开房间</button>
              </div>

              {/* 只有子房间才显示状态按钮，大厅不显示 */}
              {!currentRoom.isDefault && (
                <div className="room-status-controls">
                  <span>房间状态:</span>
                  <div className="status-buttons">
                    {/* 找到当前用户在房间中的状态 */}
                    {(() => {
                      const currentUserInRoom = roomUsers.find(u => u.id === user.id);
                      const userStatus = currentUserInRoom ? currentUserInRoom.status : 'idle';
                      return (
                        <>
                          <button
                            className={`status-btn ${userStatus === 'matching' ? 'active' : ''}`}
                            style={{ backgroundColor: userStatus === 'matching' ? statusColors.matching : '#999999' }}
                            onClick={() => changeRoomStatus('matching')}
                          >
                            匹配中
                          </button>
                          <button
                            className={`status-btn ${userStatus === 'gaming' ? 'active' : ''}`}
                            style={{ backgroundColor: userStatus === 'gaming' ? statusColors.gaming : '#999999' }}
                            onClick={() => changeRoomStatus('gaming')}
                          >
                            游戏中
                          </button>
                          <button
                            className={`status-btn ${userStatus === 'idle' ? 'active' : ''}`}
                            style={{ backgroundColor: userStatus === 'idle' ? statusColors.idle : '#999999' }}
                            onClick={() => changeRoomStatus('idle')}
                          >
                            空闲
                          </button>
                        </>
                      );
                    })()}
                  </div>
                </div>
              )}

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

              {/* 聊天功能 */}
              <div className="chat-section">
                <h3>聊天</h3>
                <div className="chat-messages">
                  {messages.map((msg, index) => (
                    <div key={index} className={`message ${msg.userId === user.id ? 'own' : ''}`}>
                      <div className="message-header">
                        <span className="message-username">{msg.username}</span>
                        <span className="message-time">{msg.timestamp}</span>
                      </div>
                      <div className="message-content">{msg.content}</div>
                    </div>
                  ))}
                </div>
                <div className="chat-input">
                  <input
                    type="text"
                    value={messageInput}
                    onChange={(e) => setMessageInput(e.target.value)}
                    onKeyPress={(e) => e.key === 'Enter' && sendMessage()}
                    placeholder="输入消息..."
                  />
                  <button onClick={sendMessage}>发送</button>
                </div>
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
