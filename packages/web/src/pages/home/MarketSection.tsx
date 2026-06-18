import { BillingPanel } from '../../features/settings/BillingPanel'
import { AgentContacts, SceneContacts } from './ContactsSection'
import { ModelMarketSection } from './ModelMarketSection'
import type { MarketKind, MarketSectionProps } from './types'

const marketTabs: { key: MarketKind; label: string }[] = [
  { key: 'agents', label: 'AI市场' },
  { key: 'models', label: '模型市场' },
  { key: 'scenes', label: '场景市场' },
  { key: 'billing', label: '我的账单' },
]

export function MarketSection(props: MarketSectionProps) {
  const { marketKind, setMarketKind, agents, scenes, reloadScenes, showCreateAgent, editingAgentId, agentForm, setAgentForm, openCreateAgent, resetAgentEditor, toggleAgentTool, createAgentFromContacts, openEditAgent, deleteAgentFromContacts } = props
  return (
    <section className="bg-white sm:rounded-xl sm:border border-gray-200 p-4 sm:p-5 mb-4 sm:mb-6">
      <div className="flex items-center justify-between gap-3 mb-3"><div><h2 className="text-lg font-semibold text-gray-800">市场</h2><p className="text-xs text-gray-500 mt-0.5">购买和发布 AI、模型服务与场景模板；账单也集中在这里查看。</p></div></div>
      <div className="overflow-x-auto pb-1 mb-4 -mx-1 px-1"><div className="inline-flex bg-gray-100 rounded-xl p-1 min-w-max">
        {marketTabs.map((tab) => <button key={tab.key} onClick={() => setMarketKind(tab.key)} className={`px-4 py-2 rounded-lg text-sm whitespace-nowrap ${marketKind === tab.key ? 'bg-white shadow-sm text-blue-600' : 'text-gray-500'}`}>{tab.label}</button>)}
      </div></div>
      {marketKind === 'agents' && <AgentContacts agents={agents} showCreateAgent={showCreateAgent} editingAgentId={editingAgentId} agentForm={agentForm} setAgentForm={setAgentForm} toggleAgentTool={toggleAgentTool} createAgentFromContacts={createAgentFromContacts} resetAgentEditor={resetAgentEditor} openCreateAgent={openCreateAgent} openEditAgent={openEditAgent} deleteAgentFromContacts={deleteAgentFromContacts} />}
      {marketKind === 'models' && <ModelMarketSection />}
      {marketKind === 'scenes' && <SceneContacts scenes={scenes} agents={agents} reloadScenes={reloadScenes} />}
      {marketKind === 'billing' && <BillingPanel />}
    </section>
  )
}
