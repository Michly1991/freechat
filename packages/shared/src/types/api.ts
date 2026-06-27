import type { User } from './user.js'

// === API Response Types ===
export interface ApiResponse<T = any> {
  success: boolean
  data?: T
  error?: {
    code: string
    message: string
  }
}

export interface PaginatedResponse<T> {
  items: T[]
  total: number
  page: number
  pageSize: number
  hasMore: boolean
}

// === Auth Types ===
export interface LoginRequest {
  username: string
  password: string
}

export interface RegisterRequest {
  username: string
  password: string
  nickname: string
}

export interface AuthResponse {
  user: User
  token: string
}
