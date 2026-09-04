import * as offlineBooks from '@/services/offlineEbookStore'

export default ({ store, $axios }, inject) => {
  inject('offlineBooks', offlineBooks)

  let syncing = false
  const sync = async () => {
    const user = store.state.user.user
    if (!user?.id || syncing || !navigator.onLine) return
    syncing = true
    try {
      offlineBooks.setActiveProfile(user)
      const result = await offlineBooks.syncPendingOperations($axios, user.id)
      if (result.synced) window.dispatchEvent(new CustomEvent('book-shelf-offline-synced', { detail: result }))
    } catch (error) {
      console.error('Failed to sync offline ebook changes', error)
    } finally {
      syncing = false
    }
  }

  store.subscribe((mutation, state) => {
    if (mutation.type !== 'user/setUser' || !state.user.user) return
    offlineBooks.setActiveProfile(state.user.user)
    sync()
  })

  if (store.state.user.user) offlineBooks.setActiveProfile(store.state.user.user)
  window.addEventListener('online', sync)
}
