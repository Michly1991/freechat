import type { Dispatch, FormEvent, MouseEvent, SetStateAction } from 'react'
import type { SwipeAction } from '../../components/SwipeActionItem'
import type { AgentFormState, AgentToolKey } from '../home-agent-form'

export type HomeTab = 'messages' | 'contacts' | 'settings'
export type ContactKind = 'people' | 'agents' | 'scenes'
export type SelectedAgent = { agentId: string; autoEnabled: boolean }

export type HeaderProps = {
  user: any
  showQuickActions: boolean
  setShowQuickActions: Dispatch<SetStateAction<boolean>>
  onShowJoin: () => void
  onShowCreate: () => void
  onShowAddFriend: () => void
  onSettings: () => void
  onLogout: () => void
}

export type DesktopTabsProps = {
  activeHomeTab: HomeTab
  setActiveHomeTab: (tab: HomeTab) => void
}

export type MobileNavProps = DesktopTabsProps

export type MessagesSectionProps = {
  conversations: any[]
  deletingId: string | null
  openSwipeId: string | null
  setOpenSwipeId: Dispatch<SetStateAction<string | null>>
  loadConversations: () => void
  getConversationActions: (conv: any) => SwipeAction[]
  toggleConversationPref: (conv: any, key: 'pinned' | 'muted' | 'hidden', e?: MouseEvent) => void
  deleteConversation: (conv: any, e?: MouseEvent) => void
  navigateTo: (path: string) => void
}

export type ContactsSectionProps = {
  contactKind: ContactKind
  setContactKind: (kind: ContactKind) => void
  searchQ: string
  setSearchQ: Dispatch<SetStateAction<string>>
  searchResults: any[]
  friends: any[]
  agents: any[]
  scenes: any[]
  reloadScenes: () => void
  friendRequests: { received: any[]; sent: any[] }
  showCreateAgent: boolean
  editingAgentId: string | null
  agentForm: AgentFormState
  setAgentForm: Dispatch<SetStateAction<AgentFormState>>
  openCreateAgent: () => void
  resetAgentEditor: () => void
  searchUsers: () => void
  sendFriendRequest: (targetUserId: string) => void
  acceptFriendRequest: (requestId: string) => void
  rejectFriendRequest: (requestId: string) => void
  openDm: (friendId: string) => void
  toggleAgentTool: (key: AgentToolKey) => void
  createAgentFromContacts: () => void
  openEditAgent: (agent: any) => void
  deleteAgentFromContacts: (agent: any) => void
}

export type SettingsSectionProps = {
  user: any
  onSettings: () => void
  onLogout: () => void
}

export type JoinRoomModalProps = {
  show: boolean
  inviteCode: string
  joining: boolean
  setInviteCode: Dispatch<SetStateAction<string>>
  setShowJoin: Dispatch<SetStateAction<boolean>>
  handleJoinRoom: (e: FormEvent) => void
}

export type AddFriendModalProps = {
  show: boolean
  searchQ: string
  searchResults: any[]
  setSearchQ: Dispatch<SetStateAction<string>>
  setShowAddFriend: Dispatch<SetStateAction<boolean>>
  searchUsers: () => void
  sendFriendRequest: (targetUserId: string) => void
}

export type CreateRoomModalProps = {
  show: boolean
  newName: string
  newDesc: string
  friends: any[]
  agents: any[]
  scenes: any[]
  selectedSceneId: string
  setSelectedSceneId: Dispatch<SetStateAction<string>>
  selectedFriendIds: string[]
  selectedAgents: SelectedAgent[]
  setNewName: Dispatch<SetStateAction<string>>
  setNewDesc: Dispatch<SetStateAction<string>>
  setShowCreate: Dispatch<SetStateAction<boolean>>
  setSelectedAgents: Dispatch<SetStateAction<SelectedAgent[]>>
  handleCreate: (e: FormEvent) => void
  toggleSelectedFriend: (friendId: string) => void
  toggleSelectedAgent: (agentId: string) => void
  setAgentAutoEnabled: (agentId: string, autoEnabled: boolean) => void
}
