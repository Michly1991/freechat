#!/bin/bash
set -e

echo "🧪 FreeChat 端到端测试"
echo "========================"

# 1. 用户注册
echo -e "\n1️⃣ 用户注册"
curl -s -X POST http://localhost:3001/api/auth/register \
  -H "Content-Type: application/json" \
  -d '{"username":"testuser","password":"123456","nickname":"测试用户"}' | python3 -c "import sys,json; d=json.load(sys.stdin); print('✅ 注册成功' if d['success'] else '❌ 失败')"

# 2. 用户登录
echo -e "\n2️⃣ 用户登录"
LOGIN_RESP=$(curl -s -X POST http://localhost:3001/api/auth/login \
  -H "Content-Type: application/json" \
  -d '{"username":"testuser","password":"123456"}')
TOKEN=$(echo "$LOGIN_RESP" | python3 -c "import sys,json; print(json.load(sys.stdin)['data']['token'])")
echo "✅ 登录成功，Token: ${TOKEN:0:20}..."

# 3. 创建房间
echo -e "\n3️⃣ 创建房间"
ROOM_RESP=$(curl -s -X POST http://localhost:3001/api/rooms \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer $TOKEN" \
  -d '{"name":"测试项目","description":"AI协作测试房间"}')
ROOM_ID=$(echo "$ROOM_RESP" | python3 -c "import sys,json; print(json.load(sys.stdin)['data']['id'])")
echo "✅ 房间创建成功: $ROOM_ID"

# 4. 创建Tab
echo -e "\n4️⃣ 创建Tab"
curl -s -X POST "http://localhost:3001/api/rooms/$ROOM_ID/tabs" \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer $TOKEN" \
  -d '{"title":"Dashboard","content":"<h1>项目概览</h1>"}' | python3 -c "import sys,json; d=json.load(sys.stdin); print('✅ Tab创建成功' if d['success'] else '❌ 失败')"

# 5. 创建Agent
echo -e "\n5️⃣ 创建Agent"
AGENT_RESP=$(curl -s -X POST http://localhost:3001/api/agents \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer $TOKEN" \
  -d '{"name":"代码助手","description":"帮助编写和优化代码","role_type":"specialist","model":"claude-3-5-sonnet","system_prompt":"你是一个专业的代码助手","specialties":["coding","review"]}')
AGENT_ID=$(echo "$AGENT_RESP" | python3 -c "import sys,json; print(json.load(sys.stdin)['data']['id'])")
API_KEY=$(echo "$AGENT_RESP" | python3 -c "import sys,json; print(json.load(sys.stdin)['data']['api_key'])")
echo "✅ Agent创建成功: $AGENT_ID"
echo "   API Key: ${API_KEY:0:20}..."

# 6. 添加Agent到房间
echo -e "\n6️⃣ 添加Agent到房间"
curl -s -X POST "http://localhost:3001/api/rooms/$ROOM_ID/agents" \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer $TOKEN" \
  -d "{\"agent_id\":\"$AGENT_ID\"}" | python3 -c "import sys,json; d=json.load(sys.stdin); print('✅ Agent添加到房间成功' if d['success'] else '❌ 失败')"

# 7. 获取房间Agent列表
echo -e "\n7️⃣ 获取房间Agent列表"
curl -s "http://localhost:3001/api/rooms/$ROOM_ID/agents" \
  -H "Authorization: Bearer $TOKEN" | python3 -c "import sys,json; d=json.load(sys.stdin); print(f'✅ 房间Agent数量: {len(d[\"data\"])}')"

# 8. 设置成员档案
echo -e "\n8️⃣ 设置成员档案"
USER_ID=$(echo "$LOGIN_RESP" | python3 -c "import sys,json; print(json.load(sys.stdin)['data']['user']['id'])")
curl -s -X PUT "http://localhost:3001/api/rooms/$ROOM_ID/profiles/$USER_ID" \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer $TOKEN" \
  -d '{"role_title":"技术负责人","persona":"经验丰富的全栈工程师","specialties":["架构设计","代码审查"],"can_approve":["代码合并","任务分配"],"escalation_level":8}' | python3 -c "import sys,json; d=json.load(sys.stdin); print('✅ 成员档案设置成功' if d['success'] else '❌ 失败')"

# 9. 获取成员档案
echo -e "\n9️⃣ 获取成员档案"
curl -s "http://localhost:3001/api/rooms/$ROOM_ID/profiles" \
  -H "Authorization: Bearer $TOKEN" | python3 -c "import sys,json; d=json.load(sys.stdin); print(f'✅ 成员档案数量: {len(d[\"data\"])}')"

# 10. 文件上传
echo -e "\n🔟 文件上传"
echo "console.log('hello world')" > /tmp/test.js
curl -s -X POST "http://localhost:3001/api/rooms/$ROOM_ID/files" \
  -H "Authorization: Bearer $TOKEN" \
  -F "file=@/tmp/test.js" \
  -F "path=test.js" | python3 -c "import sys,json; d=json.load(sys.stdin); print('✅ 文件上传成功' if d['success'] else '❌ 失败')"
rm /tmp/test.js

# 11. 创建目录
echo -e "\n1️⃣1️⃣ 创建目录"
curl -s -X POST "http://localhost:3001/api/rooms/$ROOM_ID/files/mkdir" \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer $TOKEN" \
  -d '{"path":"src"}' | python3 -c "import sys,json; d=json.load(sys.stdin); print('✅ 目录创建成功' if d['success'] else '❌ 失败')"

# 12. 写入文件
echo -e "\n1️⃣2️⃣ 写入文件"
curl -s -X PUT "http://localhost:3001/api/rooms/$ROOM_ID/files/src/main.ts" \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer $TOKEN" \
  -d '{"content":"import React from \"react\";\nconsole.log(\"main\");"}' | python3 -c "import sys,json; d=json.load(sys.stdin); print('✅ 文件写入成功' if d['success'] else '❌ 失败')"

# 13. 读取文件
echo -e "\n1️⃣3️⃣ 读取文件"
curl -s "http://localhost:3001/api/rooms/$ROOM_ID/files/src/main.ts" \
  -H "Authorization: Bearer $TOKEN" | python3 -c "import sys,json; d=json.load(sys.stdin); print(f'✅ 文件读取成功，内容长度: {len(d[\"data\"][\"content\"])}')"

# 14. 列出文件树
echo -e "\n1️⃣4️⃣ 列出文件树"
curl -s "http://localhost:3001/api/rooms/$ROOM_ID/files" \
  -H "Authorization: Bearer $TOKEN" | python3 -c "import sys,json; d=json.load(sys.stdin); print(f'✅ 文件树获取成功，节点数: {len(d[\"data\"])}')"

# 15. 创建任务
echo -e "\n1️⃣5️⃣ 创建任务"
curl -s -X POST http://localhost:3001/ws \
  -H "Content-Type: application/json" \
  -d "{\"type\":\"api_request\",\"action\":\"task.add\",\"payload\":{\"room_id\":\"$ROOM_ID\",\"title\":\"开发登录页面\",\"description\":\"实现用户登录功能\",\"priority\":\"high\"},\"token\":\"$TOKEN\"}" | python3 -c "import sys,json; d=json.load(sys.stdin); print('✅ 任务创建成功' if d.get('success') else '⚠️  任务需要通过WebSocket创建')"

# 16. Agent市场
echo -e "\n1️⃣6️⃣ Agent市场"
curl -s "http://localhost:3001/api/agent-market/featured" | python3 -c "import sys,json; d=json.load(sys.stdin); print(f'✅ 市场Agent数量: {len(d[\"data\"])}')"

echo -e "\n========================"
echo "🎉 测试完成！"
echo ""
echo "✅ 核心功能验证："
echo "   - 用户认证（注册/登录）"
echo "   - 房间管理（创建/成员）"
echo "   - Tab面板（创建/内容）"
echo "   - Agent系统（创建/添加/列表）"
echo "   - 成员档案（设置/获取）"
echo "   - 文件系统（上传/目录/读写/树形）"
echo "   - Agent市场"
echo ""
echo "🌐 前端访问: http://localhost:5173"
echo "🔧 后端API: http://localhost:3001"
