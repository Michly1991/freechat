import { AgentContacts, SceneContacts } from './ContactsSection'
import { ModelMarketSection } from './ModelMarketSection'
import type { MarketKind, MarketSectionProps } from './types'

const marketTabs: { key: MarketKind; label: string }[] = [
  { key: 'agents', label: 'AI市场' },
  { key: 'models', label: '模型市场' },
  { key: 'scenes', label: '场景市场' },
]

export function MarketSection(props: MarketSectionProps) {
  const { marketKind, setMarketKind, agents, scenes, reloadScenes, reloadAgents, showCreateAgent, editingAgentId, agentForm, setAgentForm, openCreateAgent, resetAgentEditor, toggleAgentTool, createAgentFromContacts, openEditAgent, deleteAgentFromContacts } = props
  return (
    <section className="bg-white sm:rounded-xl sm:border border-gray-200 p-4 sm:p-5 mb-4 sm:mb-6">
      <div className="flex items-center justify-between gap-3 mb-3"><div><h2 className="text-lg font-semibold text-gray-800">市场</h2><p className="text-xs text-gray-500 mt-0.5">购买和发布 AI、模型服务与场景模板。</p></div></div>
      <div className="overflow-x-auto pb-1 mb-4 -mx-1 px-1"><div className="inline-flex bg-gray-100 rounded-2xl p-1.5 min-w-max shadow-inner">
        {marketTabs.map((tab) => <button key={tab.key} onClick={() => setMarketKind(tab.key)} className={`min-h-11 rounded-xl px-5 py-2.5 text-sm font-medium whitespace-nowrap transition active:scale-[0.98] sm:min-h-0 sm:px-4 sm:py-2 ${marketKind === tab.key ? 'bg-white shadow-sm text-blue-600 ring-1 ring-blue-100' : 'text-gray-500 hover:bg-white/60 hover:text-gray-700'}`}>{tab.label}</button>)}
      </div></div>
      {marketKind === 'agents' && <AgentContacts mode="market" agents={agents.filter((agent) => agent.marketListed)} reloadAgents={reloadAgents} showCreateAgent={showCreateAgent} editingAgentId={editingAgentId} agentForm={agentForm} setAgentForm={setAgentForm} toggleAgentTool={toggleAgentTool} createAgentFromContacts={createAgentFromContacts} resetAgentEditor={resetAgentEditor} openCreateAgent={openCreateAgent} openEditAgent={openEditAgent} deleteAgentFromContacts={deleteAgentFromContacts} />}
      {marketKind === 'models' && <ModelMarketSection />}
      {marketKind === 'scenes' && <SceneContacts mode="market" scenes={scenes.filter((scene) => scene.marketListed || scene.isBuiltIn)} agents={agents} reloadScenes={reloadScenes} />}
    </section>
  )
}
