// === User & Agent Types ===
export type UserIdentityType = 'human' | 'agent'

export interface User {
  id: string
  username: string
  nickname: string
  avatar?: string
  role: 'user' | 'admin'
  identityType: UserIdentityType
  createdAt: number
}

