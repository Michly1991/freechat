import { RoomChatPanel } from './RoomChatPanel'
import { RoomFilesPanel } from './RoomFilesPanel'
import { RoomTabsPanel } from './RoomTabsPanel'
import { RoomAgentManagementPanel } from './RoomAgentManagementPanel'
import { RoomTasksPanel } from './RoomTasksPanel'
import { RoomBillingPanel } from './RoomBillingPanel'

export function RoomMainPanel(props: any) {
  const {
    roomId, activePanel, messages, user, unreadMarkerAt, messagesScrollRef, messagesEndRef,
    roomNewMessageCount, scrollToBottomAndRead, sendMessage, pendingAttachments, onAddAttachments, onRemoveAttachment, showMentionPopup,
    filteredMembers, filteredAgents, filteredFiles, insertMention, inputRef, input,
    handleInputChange, voiceAvailable, voiceChatEnabled, voiceStatus, voiceBusy, onVoiceEnable,
    onVoiceDisable, onVoiceTranscript, onVoiceRecordingChange, onVoiceBusyChange,
    sendError, wsNoticeDismissed, setWsNoticeDismissed, renderInteractionCard,
    getActorAvatar, getActorMember, getActorAgent,
    openMemberProfile, handleMessagesScroll, loadingOlderMessages, hasMoreMessages,
    files, currentFile, setCurrentFile, fileDirty, setFileDirty, openFile, saveFile,
    deleteFile, createFile, createFolder, uploadLocalFile, activeTabId, tabs,
    roomAgents, feedback, showCreateTab, setShowCreateTab, newTabName, setNewTabName,
    newTabContent, setNewTabContent, createTab, deleteTab, editingTabId, setEditingTabId,
    editingTabTitle, setEditingTabTitle, editingTabContent, setEditingTabContent,
    updateTab, beginEditTab, tabError, tasks, newTaskTitle, setNewTaskTitle,
    creatingTask, createTask, expandedTaskIds, toggleTaskExpanded, newSubtaskTitles,
    setNewSubtaskTitles, showArchivedTasks, setShowArchivedTasks, updateTaskStatus,
    retryTaskFailedItems, deleteTask, createSubtask, updateSubtaskStatus, retrySubtask,
    deleteSubtask, renderAssigneeBadge, setActiveTabId,
  } = props
  const isAgentManagementTab = activeTabId && tabs.find((tab: any) => tab.id === activeTabId && (tab.title || '').includes('Agent管理'))

  if (activePanel === 'chat') {
    return <RoomChatPanel roomId={roomId} messages={messages} user={user} unreadMarkerAt={unreadMarkerAt} messagesScrollRef={messagesScrollRef} messagesEndRef={messagesEndRef} roomNewMessageCount={roomNewMessageCount} scrollToBottomAndRead={scrollToBottomAndRead} sendMessage={sendMessage} pendingAttachments={pendingAttachments} onAddAttachments={onAddAttachments} onRemoveAttachment={onRemoveAttachment} showMentionPopup={showMentionPopup} filteredMembers={filteredMembers} filteredAgents={filteredAgents} filteredFiles={filteredFiles} insertMention={insertMention} inputRef={inputRef} input={input} handleInputChange={handleInputChange} voiceAvailable={voiceAvailable} voiceChatEnabled={voiceChatEnabled} voiceStatus={voiceStatus} voiceBusy={voiceBusy} onVoiceEnable={onVoiceEnable} onVoiceDisable={onVoiceDisable} onVoiceTranscript={onVoiceTranscript} onVoiceRecordingChange={onVoiceRecordingChange} onVoiceBusyChange={onVoiceBusyChange} sendError={sendError} wsNoticeDismissed={wsNoticeDismissed} setWsNoticeDismissed={setWsNoticeDismissed} renderInteractionCard={renderInteractionCard} getActorAvatar={getActorAvatar} getActorMember={getActorMember} getActorAgent={getActorAgent} openMemberProfile={openMemberProfile} onMessagesScroll={handleMessagesScroll} loadingOlderMessages={loadingOlderMessages} hasMoreMessages={hasMoreMessages} />
  }
  if (activePanel === 'files') {
    return <RoomFilesPanel files={files} currentFile={currentFile} setCurrentFile={setCurrentFile} fileDirty={fileDirty} setFileDirty={setFileDirty} openFile={openFile} saveFile={saveFile} deleteFile={deleteFile} createFile={createFile} createFolder={createFolder} uploadLocalFile={uploadLocalFile} />
  }
  if (activePanel === 'tabs' && isAgentManagementTab) return <RoomAgentManagementPanel roomAgents={roomAgents} feedback={feedback} />
  if (activePanel === 'tabs') {
    return <RoomTabsPanel roomId={roomId} tabs={tabs} activeTabId={activeTabId} setActiveTabId={setActiveTabId} showCreateTab={showCreateTab} setShowCreateTab={setShowCreateTab} newTabName={newTabName} setNewTabName={setNewTabName} newTabContent={newTabContent} setNewTabContent={setNewTabContent} createTab={createTab} deleteTab={deleteTab} editingTabId={editingTabId} setEditingTabId={setEditingTabId} editingTabTitle={editingTabTitle} setEditingTabTitle={setEditingTabTitle} editingTabContent={editingTabContent} setEditingTabContent={setEditingTabContent} updateTab={updateTab} beginEditTab={beginEditTab} tabError={tabError} />
  }
  if (activePanel === 'tasks') {
    return <RoomTasksPanel tasks={tasks} sendError={sendError} wsNoticeDismissed={wsNoticeDismissed} setWsNoticeDismissed={setWsNoticeDismissed} newTaskTitle={newTaskTitle} setNewTaskTitle={setNewTaskTitle} creatingTask={creatingTask} createTask={createTask} expandedTaskIds={expandedTaskIds} toggleTaskExpanded={toggleTaskExpanded} newSubtaskTitles={newSubtaskTitles} setNewSubtaskTitles={setNewSubtaskTitles} showArchivedTasks={showArchivedTasks} setShowArchivedTasks={setShowArchivedTasks} updateTaskStatus={updateTaskStatus} retryTaskFailedItems={retryTaskFailedItems} deleteTask={deleteTask} createSubtask={createSubtask} updateSubtaskStatus={updateSubtaskStatus} retrySubtask={retrySubtask} deleteSubtask={deleteSubtask} renderAssigneeBadge={renderAssigneeBadge} />
  }
  if (activePanel === 'billing') return <RoomBillingPanel roomId={roomId} />
  return null
}
