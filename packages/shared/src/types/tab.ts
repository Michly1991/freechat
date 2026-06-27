// === Tab Types ===
export interface Tab {
  id: string
  roomId: string
  title: string
  icon?: string
  sortOrder: number
  createdBy: string
  createdAt: number
  updatedAt: number
}
