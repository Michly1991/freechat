import { chmod, cp, mkdir, readFile, rename, rm, symlink, writeFile } from 'fs/promises'
import { existsSync } from 'fs'
import { join } from 'path'
import { config } from '../config.js'
import type { Agent } from '@freechat/shared'
import { agentCapabilityService } from './agent-capability.service.js'

function safeName(value: string) {
  return String(value || 'item').replace(/[^a-zA-Z0-9._-]+/g, '-').replace(/^-+|-+$/g, '') || 'item'
}

function scriptExt(language: string) {
  return language === 'python' ? 'py' : language === 'typescript' ? 'ts' : language === 'javascript' ? 'js' : language === 'bash' ? 'sh' : 'txt'
}

function generatedAgentMarkdown(agent: Agent) {
  const cfg: any = agent.config || {}
  const specialties = Array.isArray(agent.specialties) && agent.specialties.length ? agent.specialties.join('、') : '未设置'
  const tools = cfg.tools || {}
  return `# ${agent.name}

## Description

${agent.description || '暂无描述。'}

## Details

- Agent ID: ${agent.id}
- Type: ${agent.roleType}
- Status: ${agent.status || 'active'}
- Specialties: ${specialties}

## Behavior

- Reply Mode: ${cfg.behavior?.replyMode || (agent.roleType === 'assistant' ? 'auto_when_relevant' : 'mention_only')}
- Silent Allowed: ${cfg.behavior?.silentAllowed !== false ? 'yes' : 'no'}

## Tools

- chat: ${tools.chat !== false ? 'enabled' : 'disabled'}
- task: ${tools.task !== false ? 'enabled' : 'disabled'}
- file: ${tools.file !== false ? 'enabled' : 'disabled'}
- tab: ${tools.tab !== false ? 'enabled' : 'disabled'}
- interaction: ${tools.interaction !== false ? 'enabled' : 'disabled'}
- members: ${tools.members !== false ? 'enabled' : 'disabled'}

## System Prompt

${cfg.systemPrompt || '未设置。'}

## Skill Index

启动后按任务需要读取 \`skills/*/SKILL.md\`。每个 Skill 自带 \`res/\` 和 \`scripts/\` 目录。
`
}

function generatedSkillMarkdown(skill: any) {
  if (String(skill.content || '').trim()) return skill.content
  return `# ${skill.name}

## Description

${skill.description || '暂无说明。'}

## Inputs

按任务上下文判断。

## Steps

1. 阅读本 Skill 的说明。
2. 必要时读取本目录下的 \`res/\`。
3. 如需脚本辅助，使用本目录下的 \`scripts/\`。

## Outputs

将正式产物写入当前房间工作区的 \`artifacts/\`、\`shared/\` 或通过 FreeChat CLI 写入项目文件。
`
}

export class AgentPackageService {
  workspaceRoot() { return config.workspace.root }
  agentPackageDir(agentId: string) { return join(config.workspace.root, 'agents', agentId) }
  systemSkillsDir() { return join(config.workspace.root, 'system-skills') }
  systemSkillDir(name: string) { return join(this.systemSkillsDir(), name) }
  roomDir(roomId: string) { return join(config.workspace.root, 'rooms', roomId) }
  legacyRoomDir(roomId: string) { return join(config.workspace.root, roomId) }
  roomAgentDir(roomId: string, agentId: string) { return join(this.roomDir(roomId), 'agents', agentId) }

  async ensureRoomWorkspace(roomId: string, room?: any) {
    const dir = this.roomDir(roomId)
    const legacy = this.legacyRoomDir(roomId)
    if (!existsSync(dir) && existsSync(legacy) && !existsSync(join(config.workspace.root, 'rooms'))) {
      await mkdir(join(config.workspace.root, 'rooms'), { recursive: true })
    }
    if (!existsSync(dir) && existsSync(legacy)) {
      await mkdir(join(config.workspace.root, 'rooms'), { recursive: true })
      await rename(legacy, dir).catch(async () => { await mkdir(dir, { recursive: true }) })
    }
    await mkdir(join(dir, 'artifacts', 'docs'), { recursive: true })
    await mkdir(join(dir, 'artifacts', 'images'), { recursive: true })
    await mkdir(join(dir, 'artifacts', 'data'), { recursive: true })
    await mkdir(join(dir, 'artifacts', 'exports'), { recursive: true })
    await mkdir(join(dir, 'shared'), { recursive: true })
    await mkdir(join(dir, 'agents'), { recursive: true })
    await mkdir(join(dir, '.freechat'), { recursive: true })
    await mkdir(join(dir, 'files'), { recursive: true })
    await mkdir(join(dir, 'meta'), { recursive: true })
    if (!existsSync(legacy)) {
      await symlink(dir, legacy, 'dir').catch(() => {})
    }
    if (room) await this.writeRoomReadme(roomId, room)
    await this.writeFilesIndex(roomId)
    return dir
  }

  async writeRoomReadme(roomId: string, room: any) {
    const text = `# ${room?.name || roomId}

## Room

- Room ID: ${roomId}
- Description: ${room?.description || '暂无描述'}
- Created By: ${room?.created_by || room?.createdBy || ''}

## Directories

- ` + '`shared/`' + `: 房间共享资料。
- ` + '`artifacts/`' + `: 房间产物。
- ` + '`agents/`' + `: 房间内 Agent 实例工作区。
- ` + '`files/`' + `: 用户可见项目文件的底层存储，Agent 运行时应通过 CLI/API 访问。
`
    await mkdir(join(this.roomDir(roomId)), { recursive: true })
    await writeFile(join(this.roomDir(roomId), 'ROOM.md'), text, 'utf8')
  }

  async writeFilesIndex(roomId: string) {
    const text = `# Files Index

房间目录：${this.roomDir(roomId)}

## Writable runtime areas

- shared/
- artifacts/
- agents/<agentId>/workspace/

## Notes

Agent 正式交付物应通过 FreeChat CLI/API 写入项目文件或放入 artifacts/shared，并保持本索引可追踪。
`
    await writeFile(join(this.roomDir(roomId), 'FILES.md'), text, 'utf8')
  }

  async ensureSystemSkills() {
    await this.writeSystemSkill('pdf-reader', 'PDF Reader', '读取、抽取、总结 PDF 文件。用户上传 PDF、要求总结 PDF、提取页码/章节/表格时使用。', 'extract_pdf.py', this.pdfScript())
    await this.writeSystemSkill('excel-reader', 'Excel Reader', '读取、抽取、总结 Excel / xlsx / csv 表格。用户上传表格、要求统计/清洗/汇总时使用。', 'extract_excel.py', this.excelScript())
    await this.writeSystemSkill('word-reader', 'Word Reader', '读取、抽取、总结 Word / docx 文档。用户上传 Word、要求总结/改写/提取结构时使用。', 'extract_word.py', this.wordScript())
    await this.writeMindmapSkill()
  }


  async writeMindmapSkill() {
    const dir = this.systemSkillDir('mindmap')
    await mkdir(join(dir, 'res'), { recursive: true })
    await mkdir(join(dir, 'scripts'), { recursive: true })
    await writeFile(join(dir, 'SKILL.md'), `# Mindmap

## Description

当用户要求画脑图、思维导图、XMind 风格结构图、知识框架、项目拆解图时使用本 Skill。

## Principles

- 脑图是 Skill 产物，不是普通聊天内置文本。
- 默认先生成一次性预览，不自动保存为正式房间文件。
- 用户确认“保存/留下/存到房间/导出”后，再调用 \`mindmap.save\` 保存。
- 不做在线编辑；用户要求调整时重新生成预览即可。
- 技术上需要落文件时只放房间 tmp 缓存，可被清理。

## App Tools

通过 \`./freechat\` 或 inline tool 调用：

- \`mindmap.create\`：生成聊天内嵌脑图预览。
  - 参数：\`title\`、\`outline\`/\`markdown\` 或 \`root\` JSON 节点树。
  - 默认返回 preview，聊天窗口直接展示。
- \`mindmap.save\`：用户确认后保存预览。
  - 参数：\`previewId\`，可选 \`targetDir\`。

## Recommended Flow

1. 把用户需求整理成 Markdown 大纲或 JSON 树。
2. 调用 \`mindmap.create\`，不要先写正式文件。
3. 回复用户“已生成预览，可重新生成或保存”。
4. 只有用户确认保存时，调用 \`mindmap.save\`。

## Example Inline Call

\`\`\`json
{"name":"mindmap.create","args":{"title":"FreeChat 架构","outline":"# FreeChat\\n- Server\\n  - Fastify\\n  - App Actions\\n- Web\\n  - Chat\\n  - Artifact Preview"}}
\`\`\`
`, 'utf8')
    await writeFile(join(dir, 'res', 'README.md'), '# Mindmap Resources\n\n可放置脑图模板、风格示例和 XMind 导出格式参考。\n', 'utf8')
  }

  async writeSystemSkill(dirName: string, title: string, description: string, scriptName: string, scriptContent: string) {
    const dir = this.systemSkillDir(dirName)
    await mkdir(join(dir, 'res'), { recursive: true })
    await mkdir(join(dir, 'scripts'), { recursive: true })
    await writeFile(join(dir, 'SKILL.md'), `# ${title}\n\n## Description\n\n${description}\n\n## Inputs\n\n- 服务端房间文件引用，例如 \`file:<fileId>\` 或房间文件路径。\n- 下载后的 Agent Client 本地文件路径。\n- 用户问题或目标。\n- 可选输出路径，建议写入当前 Agent 私有 \`res/\` 或 \`workspace/\`。\n\n## Steps\n\n1. 先用 \`./freechat file download file:<fileId> res/<filename>\` 把房间文件下载到 Agent Client 本地；不要要求服务端解析复杂文件。\n2. 运行 \`scripts/${scriptName} res/<filename> [res/output.md]\` 抽取文本/表格为 Markdown。\n3. 文件很长时按页、sheet 或标题分块阅读。\n4. 根据用户问题总结、定位或生成结构化产物。\n5. 正式产物必须通过 \`./freechat file upload\`、\`./freechat file write-local\`、\`./freechat tab create-local\` 或其他 FreeChat CLI 写回当前房间。\n\n## Outputs\n\n- Markdown 抽取结果。\n- 摘要、页码/sheet/段落引用。\n- 可选产物文件。\n`, 'utf8')
    const scriptPath = join(dir, 'scripts', scriptName)
    await writeFile(scriptPath, scriptContent, 'utf8')
    await chmod(scriptPath, 0o700).catch(() => {})
    await writeFile(join(dir, 'res', 'README.md'), `# ${title} Resources\n\n放置该公共 Skill 的模板、示例、提示词和参考资料。\n`, 'utf8')
  }

  async mountSystemSkills(targetSkillsDir: string) {
    await this.ensureSystemSkills()
    await mkdir(targetSkillsDir, { recursive: true })
    for (const name of ['pdf-reader', 'excel-reader', 'word-reader', 'mindmap']) {
      const source = this.systemSkillDir(name)
      const target = join(targetSkillsDir, name)
      if (existsSync(target)) continue
      const relativeSource = source
      await symlink(relativeSource, target, 'dir').catch(async () => {
        await cp(source, target, { recursive: true, force: true }).catch(() => {})
      })
    }
  }

  pdfScript() { return `#!/usr/bin/env python3\nimport sys, pathlib, subprocess\n\ndef fail(msg):\n    print(msg, file=sys.stderr); sys.exit(2)\n\nif len(sys.argv) < 2:\n    fail('Usage: extract_pdf.py <file.pdf> [output.md]')\npath = pathlib.Path(sys.argv[1])\nout = pathlib.Path(sys.argv[2]) if len(sys.argv) > 2 else None\ntext = ''\ntry:\n    import pypdf\n    reader = pypdf.PdfReader(str(path))\n    parts = []\n    for i, page in enumerate(reader.pages, 1):\n        parts.append(f'\\n\\n## Page {i}\\n\\n' + (page.extract_text() or ''))\n    text = ''.join(parts)\nexcept Exception:\n    try:\n        import PyPDF2\n        reader = PyPDF2.PdfReader(str(path))\n        parts = []\n        for i, page in enumerate(reader.pages, 1):\n            parts.append(f'\\n\\n## Page {i}\\n\\n' + (page.extract_text() or ''))\n        text = ''.join(parts)\n    except Exception:\n        try:\n            text = subprocess.check_output(['pdftotext', str(path), '-'], text=True, errors='ignore')\n        except Exception as e:\n            fail('PDF extraction dependency missing. Install pypdf/PyPDF2 or pdftotext. Detail: ' + str(e))\nmarkdown = f'# PDF Extract: {path.name}\\n' + text\nif out:\n    out.parent.mkdir(parents=True, exist_ok=True); out.write_text(markdown, encoding='utf-8')\nelse:\n    print(markdown)\n` }

  excelScript() { return `#!/usr/bin/env python3\nimport sys, pathlib, csv\n\ndef fail(msg):\n    print(msg, file=sys.stderr); sys.exit(2)\n\nif len(sys.argv) < 2:\n    fail('Usage: extract_excel.py <file.xlsx|csv> [output.md]')\npath = pathlib.Path(sys.argv[1])\nout = pathlib.Path(sys.argv[2]) if len(sys.argv) > 2 else None\nparts = [f'# Excel Extract: {path.name}\\n']\nif path.suffix.lower() == '.csv':\n    with path.open(newline='', encoding='utf-8-sig') as f:\n        rows = list(csv.reader(f))\n    parts.append('## CSV\\n')\n    for row in rows:\n        parts.append('| ' + ' | '.join(str(c).replace('\\n',' ') for c in row) + ' |')\nelse:\n    try:\n        import openpyxl\n    except Exception as e:\n        fail('Excel extraction dependency missing. Install openpyxl for xlsx files. Detail: ' + str(e))\n    wb = openpyxl.load_workbook(path, data_only=True, read_only=True)\n    for ws in wb.worksheets:\n        parts.append(f'\\n\\n## Sheet: {ws.title}\\n')\n        for row in ws.iter_rows(values_only=True):\n            parts.append('| ' + ' | '.join('' if c is None else str(c).replace('\\n',' ') for c in row) + ' |')\nmarkdown='\\n'.join(parts)\nif out:\n    out.parent.mkdir(parents=True, exist_ok=True); out.write_text(markdown, encoding='utf-8')\nelse:\n    print(markdown)\n` }

  wordScript() { return `#!/usr/bin/env python3\nimport sys, pathlib, zipfile, xml.etree.ElementTree as ET\n\ndef fail(msg):\n    print(msg, file=sys.stderr); sys.exit(2)\n\nif len(sys.argv) < 2:\n    fail('Usage: extract_word.py <file.docx> [output.md]')\npath = pathlib.Path(sys.argv[1])\nout = pathlib.Path(sys.argv[2]) if len(sys.argv) > 2 else None\ntry:\n    import docx\n    doc = docx.Document(str(path))\n    paragraphs = [p.text for p in doc.paragraphs if p.text.strip()]\n    text = '\\n\\n'.join(paragraphs)\nexcept Exception:\n    if path.suffix.lower() != '.docx':\n        fail('Only docx is supported without python-docx/libreoffice.')\n    try:\n        with zipfile.ZipFile(path) as z:\n            xml = z.read('word/document.xml')\n        root = ET.fromstring(xml)\n        ns = {'w': 'http://schemas.openxmlformats.org/wordprocessingml/2006/main'}\n        paras=[]\n        for p in root.findall('.//w:p', ns):\n            txt=''.join(t.text or '' for t in p.findall('.//w:t', ns))\n            if txt.strip(): paras.append(txt)\n        text='\\n\\n'.join(paras)\n    except Exception as e:\n        fail('Word extraction failed. Install python-docx for better docx support. Detail: '+str(e))\nmarkdown=f'# Word Extract: {path.name}\\n\\n'+text\nif out:\n    out.parent.mkdir(parents=True, exist_ok=True); out.write_text(markdown, encoding='utf-8')\nelse:\n    print(markdown)\n` }

  async ensureAgentPackage(agent: Agent) {
    const dir = this.agentPackageDir(agent.id)
    await mkdir(join(dir, 'res'), { recursive: true })
    await mkdir(join(dir, 'skills'), { recursive: true })
    await mkdir(join(dir, 'scripts'), { recursive: true })
    const cfg: any = agent.config || {}
    await writeFile(join(dir, 'AGENT.md'), cfg.agentMarkdown || generatedAgentMarkdown(agent), 'utf8')

    const skills = agentCapabilityService.listSkills(agent.id)
    for (const skill of skills) await this.writeSkillPackage(agent.id, skill)

    const scripts = agentCapabilityService.listScripts(agent.id)
    for (const script of scripts) {
      const scriptPath = join(dir, 'scripts', `${safeName(script.name)}.${scriptExt(script.language)}`)
      await writeFile(scriptPath, script.content || '', 'utf8')
    }
    return dir
  }

  async writeSkillPackage(agentId: string, skill: any) {
    const dir = join(this.agentPackageDir(agentId), 'skills', safeName(skill.name || skill.id))
    await mkdir(join(dir, 'res'), { recursive: true })
    await mkdir(join(dir, 'scripts'), { recursive: true })
    await writeFile(join(dir, 'SKILL.md'), generatedSkillMarkdown(skill), 'utf8')
    return dir
  }

  async deleteSkillPackage(agentId: string, skill: any) {
    await rm(join(this.agentPackageDir(agentId), 'skills', safeName(skill?.name || skill?.id || 'item')), { recursive: true, force: true }).catch(() => {})
  }

  async ensureRoomAgentWorkspace(roomId: string, agent: Agent) {
    const room: any = { id: roomId }
    await this.ensureRoomWorkspace(roomId, room)
    await this.ensureAgentPackage(agent)
    const dir = this.roomAgentDir(roomId, agent.id)
    await mkdir(join(dir, 'workspace'), { recursive: true })
    await mkdir(join(dir, 'res'), { recursive: true })
    const skillsDir = join(dir, 'skills')
    await mkdir(skillsDir, { recursive: true })
    await mkdir(join(dir, 'scripts'), { recursive: true })
    await mkdir(join(dir, '.freechat'), { recursive: true })
    await this.mountSystemSkills(skillsDir)
    return dir
  }

  async readAgentMarkdown(agent: Agent) {
    await this.ensureAgentPackage(agent)
    return readFile(join(this.agentPackageDir(agent.id), 'AGENT.md'), 'utf8')
  }
}

export const agentPackageService = new AgentPackageService()
