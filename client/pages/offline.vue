<template>
  <main class="h-screen overflow-y-auto bg-[#181818] text-white">
    <header class="sticky top-0 z-20 flex items-center gap-3 border-b border-white/10 bg-[#202020]/95 px-4 py-3 backdrop-blur">
      <img :src="`${$config.routerBasePath}/icon.svg`" alt="" class="h-9 w-9" />
      <div class="min-w-0">
        <h1 class="text-xl font-semibold">Offline books</h1>
        <p class="truncate text-xs text-white/60">{{ profileLabel }}</p>
      </div>
      <div class="grow" />
      <span class="rounded-full px-2 py-1 text-xs" :class="online ? 'bg-success/20 text-success' : 'bg-white/10 text-white/70'">
        {{ online ? 'Online' : 'Offline' }}
      </span>
      <nuxt-link v-if="online" to="/" class="rounded border border-white/20 px-3 py-2 text-sm hover:bg-white/10">Open library</nuxt-link>
    </header>

    <section class="mx-auto max-w-6xl p-4 sm:p-8">
      <div class="mb-6 rounded-lg border border-white/10 bg-white/5 p-4 text-sm text-white/70">
        Saved EPUBs, reading positions, highlights, notes, and bookmarks remain on this device. Pending changes sync after you reconnect and open the authenticated library.
      </div>

      <p v-if="loading" class="py-16 text-center text-white/60">Loading offline books…</p>
      <div v-else-if="!books.length" class="py-16 text-center">
        <span class="material-symbols mb-3 text-6xl text-white/30">cloud_off</span>
        <h2 class="text-xl">No books saved on this device</h2>
        <p class="mt-2 text-white/60">While connected, open a book’s details and choose “Save offline.”</p>
        <nuxt-link v-if="online" to="/" class="mt-5 inline-block rounded bg-info px-4 py-2">Browse library</nuxt-link>
      </div>

      <div v-else class="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
        <article v-for="book in books" :key="book.key" class="flex min-h-48 overflow-hidden rounded-lg border border-white/10 bg-white/5 shadow-lg">
          <div class="w-28 shrink-0 bg-black/30 sm:w-32">
            <img v-if="coverUrls[book.key]" :src="coverUrls[book.key]" alt="" class="h-full w-full object-contain" />
            <div v-else class="flex h-full items-center justify-center"><span class="material-symbols text-5xl text-white/20">menu_book</span></div>
          </div>
          <div class="flex min-w-0 grow flex-col p-4">
            <h2 class="line-clamp-3 text-lg font-semibold">{{ titleFor(book) }}</h2>
            <p class="mt-1 line-clamp-2 text-sm text-white/60">{{ authorFor(book) }}</p>
            <p class="mt-2 text-xs text-white/50">{{ formatBytes(book.size) }} · {{ progressFor(book) }}<span v-if="pendingCounts[book.key]"> · {{ pendingCounts[book.key] }} pending</span></p>
            <div class="grow" />
            <div class="mt-4 flex items-center gap-2">
              <button type="button" class="rounded bg-info px-4 py-2 text-sm font-medium" @click="readBook(book)">Read</button>
              <button type="button" class="rounded border border-white/20 px-3 py-2 text-sm text-white/70 hover:bg-white/10" @click="removeOfflineBook(book)">Remove</button>
            </div>
          </div>
        </article>
      </div>
    </section>

    <readers-reader />
  </main>
</template>

<script>
export default {
  layout: 'blank',
  data() {
    return {
      books: [],
      coverUrls: {},
      pendingCounts: {},
      loading: true,
      online: true,
      profile: null
    }
  },
  computed: {
    profileLabel() {
      if (!this.profile) return 'This device'
      return this.profile.username ? `Saved for ${this.profile.username}` : 'Saved on this device'
    }
  },
  methods: {
    titleFor(book) {
      return book.libraryItem?.media?.metadata?.title || 'Untitled book'
    },
    authorFor(book) {
      const metadata = book.libraryItem?.media?.metadata || {}
      return metadata.authorName || metadata.authors?.map((author) => author.name).join(', ') || 'Unknown author'
    },
    progressFor(book) {
      const progress = Number(book.progress?.ebookProgress || 0)
      return progress > 0 ? `${Math.round(progress * 100)}% read` : 'Not started'
    },
    formatBytes(bytes) {
      if (!bytes) return 'Unknown size'
      if (bytes < 1024 * 1024) return `${Math.max(1, Math.round(bytes / 1024))} KB`
      return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
    },
    updateConnectivity() {
      this.online = navigator.onLine
    },
    async loadBooks() {
      this.loading = true
      this.profile = this.$offlineBooks.getActiveProfile()
      try {
        this.books = await this.$offlineBooks.listBooks()
        await Promise.all(
          this.books.map(async (book) => {
            const count = await this.$offlineBooks.pendingOperationCount(book.libraryItemId, book.fileId, book.ownerId)
            this.$set(this.pendingCounts, book.key, count)
          })
        )
        this.books.forEach((book) => {
          if (!book.coverData) return
          const blob = new Blob([book.coverData], { type: book.coverType || 'image/jpeg' })
          this.$set(this.coverUrls, book.key, URL.createObjectURL(blob))
        })
      } catch (error) {
        console.error('Failed to load offline books', error)
        this.$toast.error(error.message || 'Failed to open offline storage')
      } finally {
        this.loading = false
      }
    },
    readBook(book) {
      const libraryItem = JSON.parse(JSON.stringify(book.libraryItem))
      libraryItem._offline = {
        ownerId: book.ownerId,
        fileId: book.fileId || null,
        progress: book.progress || null
      }
      this.$store.commit('showEReader', {
        libraryItem,
        keepProgress: true,
        fileId: book.fileId || null
      })
    },
    async removeOfflineBook(book) {
      try {
        await this.$offlineBooks.removeBook(book.libraryItemId, book.fileId, book.ownerId)
        if (this.coverUrls[book.key]) URL.revokeObjectURL(this.coverUrls[book.key])
        this.$delete(this.coverUrls, book.key)
        this.$delete(this.pendingCounts, book.key)
        this.books = this.books.filter((item) => item.key !== book.key)
      } catch (error) {
        this.$toast.error(error.message || 'Failed to remove offline book')
      }
    }
  },
  mounted() {
    this.online = navigator.onLine
    window.addEventListener('online', this.updateConnectivity)
    window.addEventListener('offline', this.updateConnectivity)
    this.loadBooks()
  },
  beforeDestroy() {
    window.removeEventListener('online', this.updateConnectivity)
    window.removeEventListener('offline', this.updateConnectivity)
    Object.values(this.coverUrls).forEach((url) => URL.revokeObjectURL(url))
  }
}
</script>
