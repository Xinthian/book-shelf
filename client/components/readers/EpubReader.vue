<template>
  <div id="epub-reader" class="h-full w-full relative">
    <div class="absolute top-4 right-14 z-20 flex gap-3">
      <button v-if="selectionDraft" type="button" aria-label="Highlight selected text" title="Highlight selected text" class="text-yellow-400 opacity-90 hover:opacity-100" @click.stop="openSelectionPanel">
        <span class="material-symbols text-2xl">ink_highlighter</span>
      </button>
      <button type="button" aria-label="Bookmark this page" title="Bookmark this page" class="opacity-80 hover:opacity-100" @click.stop="createPageBookmark">
        <span class="material-symbols text-2xl">bookmark_add</span>
      </button>
      <button type="button" aria-label="Annotations" title="Annotations" class="opacity-80 hover:opacity-100" @click.stop="annotationsOpen = !annotationsOpen">
        <span class="material-symbols text-2xl">{{ annotations.length ? 'bookmarks' : 'bookmark' }}</span>
      </button>
    </div>

    <div v-if="selectionDraft && selectionPanelOpen" class="absolute z-50 left-1/2 bottom-6 sm:bottom-auto sm:top-20 -translate-x-1/2 w-[min(28rem,calc(100%-2rem))] rounded-lg bg-bg group-data-[theme=amoled]:bg-black border border-white/20 shadow-xl p-4" @click.stop>
      <p class="text-sm opacity-70 mb-2 line-clamp-3">{{ selectionDraft.selectedText }}</p>
      <textarea v-model="selectionDraft.note" rows="2" maxlength="20000" placeholder="Add a note (optional)" class="w-full rounded bg-primary border border-white/20 p-2 mb-3"></textarea>
      <div class="flex items-center gap-2 mb-3">
        <button v-for="color in annotationColors" :key="color" type="button" class="w-7 h-7 rounded-full border-2" :class="selectionDraft.color === color ? 'border-white' : 'border-transparent'" :style="{ backgroundColor: annotationColorValues[color] }" :aria-label="`Use ${color} highlight`" @click="selectionDraft.color = color"></button>
      </div>
      <div class="flex justify-end gap-2">
        <button type="button" class="px-3 py-2 opacity-80" @click="cancelSelection">Cancel</button>
        <button type="button" class="px-3 py-2 rounded bg-primary-500 text-white" @click="saveSelectionAnnotation">Save highlight</button>
      </div>
    </div>

    <div v-if="annotationsOpen" class="absolute z-40 right-0 top-0 h-full w-[min(24rem,90vw)] bg-bg group-data-[theme=amoled]:bg-black border-l border-white/10 shadow-2xl p-4 overflow-y-auto" @click.stop>
      <div class="flex items-center justify-between mb-4">
        <h2 class="text-xl font-semibold">Annotations</h2>
        <button type="button" aria-label="Close annotations" @click="annotationsOpen = false"><span class="material-symbols">close</span></button>
      </div>
      <p v-if="annotationsLoading" class="opacity-60">Loading…</p>
      <p v-else-if="!annotations.length" class="opacity-60">Select text to highlight it, or bookmark the current page.</p>
      <article v-for="annotation in annotations" :key="annotation.id" class="border-b border-white/10 py-3">
        <button type="button" class="w-full text-left" @click="goToAnnotation(annotation)">
          <div class="flex items-center gap-2 mb-1">
            <span class="material-symbols text-lg">{{ annotation.type === 'bookmark' ? 'bookmark' : 'ink_highlighter' }}</span>
            <span class="text-xs uppercase opacity-60">{{ annotation.type }}</span>
          </div>
          <p v-if="annotation.selectedText" class="text-sm line-clamp-3">{{ annotation.selectedText }}</p>
        </button>
        <textarea v-model="annotation.note" rows="2" maxlength="20000" placeholder="Add a note" class="w-full rounded bg-primary border border-white/20 p-2 mt-2 text-sm" @change="updateAnnotation(annotation)"></textarea>
        <div class="flex justify-end mt-1">
          <button type="button" class="text-sm text-error hover:underline" @click="deleteAnnotation(annotation)">Delete</button>
        </div>
      </article>
    </div>
    <div class="h-full flex items-center justify-center">
      <button type="button" aria-label="Previous page" class="w-24 max-w-24 h-full hidden sm:flex items-center overflow-x-hidden justify-center opacity-50 hover:opacity-100">
        <span v-if="hasPrev" class="material-symbols text-6xl" @mousedown.prevent @click="prev">chevron_left</span>
      </button>
      <div id="frame" class="w-full" style="height: 80%">
        <div id="viewer"></div>
      </div>
      <button type="button" aria-label="Next page" class="w-24 max-w-24 h-full hidden sm:flex items-center justify-center overflow-x-hidden opacity-50 hover:opacity-100">
        <span v-if="hasNext" class="material-symbols text-6xl" @mousedown.prevent @click="next">chevron_right</span>
      </button>
    </div>
  </div>
</template>

<script>
import ePub from 'epubjs'

/**
 * @typedef {object} EpubReader
 * @property {ePub.Book} book
 * @property {ePub.Rendition} rendition
 */
export default {
  props: {
    libraryItem: {
      type: Object,
      default: () => {}
    },
    playerOpen: Boolean,
    keepProgress: Boolean,
    fileId: String
  },
  data() {
    return {
      windowWidth: 0,
      windowHeight: 0,
      /** @type {ePub.Book} */
      book: null,
      /** @type {ePub.Rendition} */
      rendition: null,
      chapters: [],
      ereaderSettings: {
        theme: 'dark',
        font: 'serif',
        fontScale: 100,
        lineSpacing: 115,
        spread: 'auto',
        textStroke: 0
      },
      annotations: [],
      annotationsLoading: false,
      annotationsOpen: false,
      selectionDraft: null,
      selectionPanelOpen: false,
      annotationColors: ['yellow', 'green', 'blue', 'pink'],
      annotationColorValues: {
        yellow: '#facc15',
        green: '#4ade80',
        blue: '#60a5fa',
        pink: '#f472b6'
      },
      selectionCaptureTimeouts: [],
      selectionPollInterval: null,
      selectionLongPressTimeout: null,
      offlineRecord: null,
      usingOfflineBook: false
    }
  },
  watch: {
    playerOpen() {
      this.resize()
    }
  },
  computed: {
    /** @returns {string} */
    libraryItemId() {
      return this.libraryItem?.id
    },
    allowScriptedContent() {
      return this.$store.getters['libraries/getLibraryEpubsAllowScriptedContent']
    },
    hasPrev() {
      return !this.rendition?.location?.atStart
    },
    hasNext() {
      return !this.rendition?.location?.atEnd
    },
    userMediaProgress() {
      if (this.libraryItem?._offline) return this.offlineRecord?.progress || this.libraryItem._offline.progress
      if (!this.libraryItemId) return
      return this.$store.getters['user/getUserMediaProgress'](this.libraryItemId)
    },
    savedEbookLocation() {
      if (!this.keepProgress) return null
      if (!this.userMediaProgress?.ebookLocation) return null
      // Validate ebookLocation is an epubcfi
      if (!String(this.userMediaProgress.ebookLocation).startsWith('epubcfi')) return null
      return this.userMediaProgress.ebookLocation
    },
    localStorageLocationsKey() {
      return `ebookLocations-${this.libraryItemId}-${this.fileId || 'primary'}`
    },
    readerWidth() {
      if (this.windowWidth < 640) return this.windowWidth
      return this.windowWidth - 200
    },
    readerHeight() {
      if (this.windowHeight < 400 || !this.playerOpen) return this.windowHeight
      return this.windowHeight - 164
    },
    ebookUrl() {
      if (this.fileId) {
        return `/api/items/${this.libraryItemId}/ebook/${this.fileId}`
      }
      return `/api/items/${this.libraryItemId}/ebook`
    },
    themeRules() {
      const theme = this.ereaderSettings.theme
      const isDark = theme === 'dark' || theme === 'amoled'
      const isAmoled = theme === 'amoled'
      const isSepia = theme === 'sepia'

      const fontColor = isDark
        ? '#fff'
        : isSepia
        ? '#5b4636'
        : '#000'

      const backgroundColor = isAmoled
        ? '#000'
        : isDark
        ? 'rgb(35 35 35)'
        : isSepia
        ? 'rgb(244, 236, 216)'
        : 'rgb(255, 255, 255)'

      const lineSpacing = this.ereaderSettings.lineSpacing / 100
      const fontScale   = this.ereaderSettings.fontScale   / 100
      const textStroke  = this.ereaderSettings.textStroke  / 100

      return {
        '*': {
          color: `${fontColor}!important`,
          'background-color': `${backgroundColor}!important`,
          'font-family': `${this.readerFontFamily}!important`,
          'line-height': `${lineSpacing * fontScale}rem!important`,
          '-webkit-text-stroke': `${textStroke}px ${fontColor}!important`
        },
        a: {
          color: `${fontColor}!important`
        }
      }
    },
    readerFontFamily() {
      const fontFamilies = {
        'Fast Sans': "'Fast Sans', sans-serif",
        'Fast Serif': "'Fast Serif', serif",
        'Fast Mono': "'Fast Mono', monospace"
      }
      return fontFamilies[this.ereaderSettings.font] || this.ereaderSettings.font || 'serif'
    }
  },
  methods: {
    offlineOwnerId() {
      return this.libraryItem?._offline?.ownerId || this.$store.state.user.user?.id || this.$offlineBooks.getActiveProfile()?.id
    },
    shouldWriteLocally() {
      return !navigator.onLine || (!!this.libraryItem?._offline && !this.$store.state.user.user?.id)
    },
    canQueueFailedRequest(error) {
      const status = error?.response?.status
      return !status || status === 401 || status === 408 || status === 429 || status >= 500
    },
    async refreshOfflineRecord() {
      this.offlineRecord = await this.$offlineBooks.getBook(this.libraryItemId, this.fileId, this.offlineOwnerId())
      return this.offlineRecord
    },
    persistCachedAnnotations() {
      if (!this.offlineRecord) return Promise.resolve()
      return this.$offlineBooks.saveAnnotations(this.libraryItemId, this.fileId, this.annotations, this.offlineOwnerId()).catch((error) => {
        console.error('Failed to update cached annotations', error)
      })
    },
    annotationMatchesThisBook(annotation) {
      return annotation.libraryItemId === this.libraryItemId && (annotation.fileId || null) === (this.fileId || null)
    },
    async loadAnnotations() {
      if (!this.libraryItemId) return
      this.annotationsLoading = true
      if (this.shouldWriteLocally() && this.offlineRecord) {
        this.annotations = this.offlineRecord.annotations || []
        this.renderAnnotations()
        this.annotationsLoading = false
        return
      }
      try {
        const response = await this.$axios.$get(`/api/me/ebook-annotations/${this.libraryItemId}`, {
          params: this.fileId ? { fileId: this.fileId } : {}
        })
        this.annotations = response.annotations || []
        this.renderAnnotations()
        await this.persistCachedAnnotations()
      } catch (error) {
        console.error('EpubReader.loadAnnotations failed:', error)
        if (this.offlineRecord && this.canQueueFailedRequest(error)) {
          this.annotations = this.offlineRecord.annotations || []
          this.renderAnnotations()
        } else {
          this.$toast.error('Failed to load annotations')
        }
      } finally {
        this.annotationsLoading = false
      }
    },
    renderAnnotation(annotation) {
      if (!this.rendition || annotation.type === 'bookmark') return
      const color = this.annotationColorValues[annotation.color] || this.annotationColorValues.yellow

      // epub.js paints highlights in an SVG overlay. WebKit can position that
      // overlay against stale pagination geometry, so the CFI resolves to the
      // correct text but the painted rectangle appears on a nearby word. The
      // Custom Highlight API paints the Range as part of the text layout and
      // remains accurate as iOS repaginates the iframe.
      const renderedWithCustomHighlights = this.rendition.getContents().some((contents) => {
        if (contents.sectionIndex !== new ePub.CFI(annotation.cfi).spinePos) return false
        return this.renderCustomHighlight(annotation, contents, color)
      })
      if (renderedWithCustomHighlights) return

      try {
        this.rendition.annotations.highlight(
          annotation.cfi,
          { annotationId: annotation.id },
          () => {
            this.annotationsOpen = true
          },
          `ebook-annotation-${annotation.id}`,
          { fill: color, 'fill-opacity': '0.35', 'mix-blend-mode': 'multiply' }
        )
      } catch (error) {
        console.error('Failed to render ebook annotation:', annotation.id, error)
      }
    },
    customHighlightName(annotation) {
      return `ebook-annotation-${annotation.id}`
    },
    renderCustomHighlight(annotation, contents, color) {
      const win = contents?.window
      if (!win?.CSS?.highlights || !win.Highlight) return false

      try {
        const range = contents.range(annotation.cfi)
        if (!range) return false

        const highlightName = this.customHighlightName(annotation)
        let stylesheet = contents.document.getElementById('abs-ebook-highlights')
        if (!stylesheet) {
          stylesheet = contents.document.createElement('style')
          stylesheet.id = 'abs-ebook-highlights'
          contents.document.head.appendChild(stylesheet)
        }
        if (!stylesheet.textContent.includes(`::highlight(${highlightName})`)) {
          stylesheet.textContent += `\n::highlight(${highlightName}) { background-color: ${color}59; }`
        }
        win.CSS.highlights.set(highlightName, new win.Highlight(range))
        return true
      } catch (error) {
        console.error('Failed to render custom ebook highlight:', annotation.id, error)
        return false
      }
    },
    removeCustomHighlight(annotation) {
      const highlightName = this.customHighlightName(annotation)
      this.rendition?.getContents().forEach((contents) => contents.window?.CSS?.highlights?.delete(highlightName))
    },
    prepareIosSelection(contents) {
      if (!contents?.document) return
      contents.document.documentElement.style.webkitTouchCallout = 'none'
      contents.document.body.style.webkitTouchCallout = 'none'
      if (!contents.document.__absContextMenuDisabled) {
        contents.document.addEventListener('contextmenu', (event) => event.preventDefault())
        contents.document.__absContextMenuDisabled = true
      }
      if (!contents.document.__absSelectionListenersAdded) {
        const captureSelection = () => this.scheduleTouchSelectionCapture(contents)
        contents.document.addEventListener('selectionchange', captureSelection)
        contents.document.addEventListener('touchstart', (event) => this.handleSelectionTouchStart(event, contents), { passive: true })
        contents.document.addEventListener('touchend', () => this.scheduleTouchSelectionCapture(contents), { passive: true })
        contents.document.addEventListener('mouseup', captureSelection, { passive: true })
        contents.document.__absSelectionListenersAdded = true
      }
    },
    renderAnnotations() {
      this.annotations.forEach(this.renderAnnotation)
    },
    selected(cfi, contents) {
      const selectedText = contents?.window?.getSelection?.().toString().trim() || ''
      this.setSelectionDraft(cfi, selectedText)
    },
    setSelectionDraft(cfi, selectedText) {
      if (!cfi || !selectedText) return false
      if (this.selectionDraft?.cfi === cfi) return
      this.selectionDraft = {
        cfi,
        selectedText,
        note: '',
        color: 'yellow'
      }
      this.selectionPanelOpen = false
      return true
    },
    selectionRange(contents) {
      const selection = contents?.window?.getSelection?.() || contents?.document?.getSelection?.()
      if (!selection) return null

      if (selection.rangeCount) {
        try {
          return selection.getRangeAt(0).cloneRange()
        } catch (error) {
          console.debug('EpubReader.selectionRange getRangeAt failed:', error)
        }
      }

      // Some iOS WebKit versions expose anchor/focus while reporting zero
      // ranges for a native selection inside an iframe.
      if (!selection.anchorNode || !selection.focusNode) return null
      const range = contents.document.createRange()
      try {
        range.setStart(selection.anchorNode, selection.anchorOffset)
        range.setEnd(selection.focusNode, selection.focusOffset)
        if (range.collapsed && (selection.anchorNode !== selection.focusNode || selection.anchorOffset !== selection.focusOffset)) {
          range.setStart(selection.focusNode, selection.focusOffset)
          range.setEnd(selection.anchorNode, selection.anchorOffset)
        }
      } catch (error) {
        try {
          range.setStart(selection.focusNode, selection.focusOffset)
          range.setEnd(selection.anchorNode, selection.anchorOffset)
        } catch (reverseError) {
          return null
        }
      }
      return range
    },
    captureTouchSelection(contents) {
      if (!contents?.window || !contents.cfiFromRange) return false
      const range = this.selectionRange(contents)
      const selectedText = range?.toString().trim() || ''
      if (!selectedText) return false

      try {
        this.setSelectionDraft(contents.cfiFromRange(range), selectedText)
        return true
      } catch (error) {
        console.error('EpubReader.captureTouchSelection failed:', error)
        return false
      }
    },
    captureWordAtPoint(contents, x, y) {
      const document = contents?.document
      if (!document || !contents.cfiFromRange) return false

      let range = document.caretRangeFromPoint?.(x, y)
      if (!range && document.caretPositionFromPoint) {
        const position = document.caretPositionFromPoint(x, y)
        if (position) {
          range = document.createRange()
          range.setStart(position.offsetNode, position.offset)
          range.collapse(true)
        }
      }
      if (!range || range.startContainer?.nodeType !== 3) return false

      const text = range.startContainer.textContent || ''
      let start = Math.min(range.startOffset, Math.max(0, text.length - 1))
      let end = start
      const isWordCharacter = (character) => !!character && !/[\s.,;:!?()[\]{}"“”]/.test(character)
      while (start > 0 && isWordCharacter(text[start - 1])) start--
      while (end < text.length && isWordCharacter(text[end])) end++
      if (start === end) return false

      range.setStart(range.startContainer, start)
      range.setEnd(range.startContainer, end)
      try {
        return this.setSelectionDraft(contents.cfiFromRange(range), range.toString().trim()) !== false
      } catch (error) {
        console.error('EpubReader.captureWordAtPoint failed:', error)
        return false
      }
    },
    handleSelectionTouchStart(event, contents) {
      this.scheduleTouchSelectionCapture(contents)
      clearTimeout(this.selectionLongPressTimeout)
      const touch = event.touches?.[0]
      if (!touch) return
      const x = touch.clientX
      const y = touch.clientY
      this.selectionLongPressTimeout = setTimeout(() => {
        if (!this.captureTouchSelection(contents)) this.captureWordAtPoint(contents, x, y)
      }, 650)
    },
    pollForSelection() {
      this.rendition?.getContents().some((contents) => this.captureTouchSelection(contents))
    },
    openSelectionPanel() {
      this.pollForSelection()
      if (this.selectionDraft) this.selectionPanelOpen = true
    },
    scheduleTouchSelectionCapture(contents) {
      this.selectionCaptureTimeouts.forEach(clearTimeout)
      // iOS may not expose the final Range until its native edit menu and
      // selection handles have settled, which can take several seconds.
      this.selectionCaptureTimeouts = [0, 100, 250, 500, 1000, 2000, 4000].map((delay) =>
        setTimeout(() => {
          this.captureTouchSelection(contents)
        }, delay)
      )
    },
    cancelSelection() {
      this.selectionDraft = null
      this.selectionPanelOpen = false
      this.rendition?.getContents().forEach((contents) => contents.window.getSelection()?.removeAllRanges())
    },
    async createAnnotation(payload) {
      if (this.shouldWriteLocally()) {
        if (!this.offlineRecord) return this.$toast.error('Save this book offline before adding offline annotations')
        const annotation = await this.$offlineBooks.createLocalAnnotation(this.libraryItemId, this.fileId, payload, this.offlineOwnerId())
        this.annotations.push(annotation)
        this.renderAnnotation(annotation)
        return annotation
      }
      try {
        const annotation = await this.$axios.$post(`/api/me/ebook-annotations/${this.libraryItemId}`, {
          ...payload,
          fileId: this.fileId || null
        })
        if (!this.annotations.find((item) => item.id === annotation.id)) {
          this.annotations.push(annotation)
          this.renderAnnotation(annotation)
        }
        await this.persistCachedAnnotations()
        return annotation
      } catch (error) {
        console.error('EpubReader.createAnnotation failed:', error)
        if (this.offlineRecord && this.canQueueFailedRequest(error)) {
          const annotation = await this.$offlineBooks.createLocalAnnotation(this.libraryItemId, this.fileId, payload, this.offlineOwnerId())
          this.annotations.push(annotation)
          this.renderAnnotation(annotation)
          return annotation
        }
        this.$toast.error('Failed to save annotation')
      }
    },
    async saveSelectionAnnotation() {
      if (!this.selectionDraft) return
      const draft = this.selectionDraft
      const annotation = await this.createAnnotation({
        type: 'highlight',
        cfi: draft.cfi,
        selectedText: draft.selectedText,
        note: draft.note,
        color: draft.color
      })
      if (annotation) {
        this.cancelSelection()
        this.$toast.success('Highlight saved')
      }
    },
    async createPageBookmark() {
      const location = this.rendition?.currentLocation?.()
      const cfi = location?.start?.cfi
      if (!cfi) return
      const duplicate = this.annotations.find((annotation) => annotation.type === 'bookmark' && annotation.cfi === cfi)
      if (duplicate) {
        this.annotationsOpen = true
        return
      }
      const annotation = await this.createAnnotation({ type: 'bookmark', cfi, color: 'yellow' })
      if (annotation) this.$toast.success('Page bookmarked')
    },
    async updateAnnotation(annotation) {
      if (this.shouldWriteLocally()) {
        await this.$offlineBooks.updateLocalAnnotation(this.libraryItemId, this.fileId, annotation, this.offlineOwnerId())
        annotation._pending = true
        return
      }
      try {
        const updated = await this.$axios.$patch(`/api/me/ebook-annotations/${this.libraryItemId}/${annotation.id}`, {
          note: annotation.note || ''
        })
        Object.assign(annotation, updated)
        await this.persistCachedAnnotations()
      } catch (error) {
        console.error('EpubReader.updateAnnotation failed:', error)
        if (this.offlineRecord && this.canQueueFailedRequest(error)) {
          await this.$offlineBooks.updateLocalAnnotation(this.libraryItemId, this.fileId, annotation, this.offlineOwnerId())
          annotation._pending = true
          return
        }
        this.$toast.error('Failed to update annotation')
      }
    },
    async deleteAnnotation(annotation) {
      if (this.shouldWriteLocally()) {
        await this.$offlineBooks.deleteLocalAnnotation(this.libraryItemId, this.fileId, annotation, this.offlineOwnerId())
        this.removeAnnotationFromReader(annotation)
        return
      }
      try {
        await this.$axios.$delete(`/api/me/ebook-annotations/${this.libraryItemId}/${annotation.id}`)
        this.removeAnnotationFromReader(annotation)
        await this.persistCachedAnnotations()
      } catch (error) {
        console.error('EpubReader.deleteAnnotation failed:', error)
        if (this.offlineRecord && this.canQueueFailedRequest(error)) {
          await this.$offlineBooks.deleteLocalAnnotation(this.libraryItemId, this.fileId, annotation, this.offlineOwnerId())
          this.removeAnnotationFromReader(annotation)
          return
        }
        this.$toast.error('Failed to delete annotation')
      }
    },
    removeAnnotationFromReader(annotation) {
      if (annotation.type !== 'bookmark') {
        this.removeCustomHighlight(annotation)
        this.rendition?.annotations.remove(annotation.cfi, 'highlight')
      }
      this.annotations = this.annotations.filter((item) => item.id !== annotation.id)
    },
    goToAnnotation(annotation) {
      this.rendition?.display(annotation.cfi)
      this.annotationsOpen = false
    },
    annotationUpdated(annotation) {
      if (!this.annotationMatchesThisBook(annotation)) return
      const existing = this.annotations.find((item) => item.id === annotation.id)
      if (existing) Object.assign(existing, annotation)
      else {
        const pending = this.annotations.find((item) => item._pending && item.type === annotation.type && item.cfi === annotation.cfi && item.selectedText === annotation.selectedText)
        if (pending) this.removeAnnotationFromReader(pending)
        this.annotations.push(annotation)
        this.renderAnnotation(annotation)
      }
      this.persistCachedAnnotations()
    },
    annotationRemoved(payload) {
      if (payload.libraryItemId !== this.libraryItemId) return
      const annotation = this.annotations.find((item) => item.id === payload.id)
      if (!annotation) return
      if (annotation.type !== 'bookmark') {
        this.removeCustomHighlight(annotation)
        this.rendition?.annotations.remove(annotation.cfi, 'highlight')
      }
      this.annotations = this.annotations.filter((item) => item.id !== payload.id)
      this.persistCachedAnnotations()
    },
    updateSettings(settings) {
      this.ereaderSettings = settings

      if (!this.rendition) return

      this.applyTheme()

      const fontScale = settings.fontScale || 100
      this.rendition.themes.fontSize(`${fontScale}%`)
      this.rendition.themes.font(this.readerFontFamily)
      this.rendition.spread(settings.spread || 'auto')
    },
    prev() {
      if (!this.rendition?.manager) return
      return this.rendition?.prev()
    },
    next() {
      if (!this.rendition?.manager) return
      return this.rendition?.next()
    },
    goToChapter(href) {
      if (!this.rendition?.manager) return
      return this.rendition?.display(href)
    },
    /** @returns {object} Returns the chapter that the `position` in the book is in */
    findChapterFromPosition(chapters, position) {
      let foundChapter
      for (let i = 0; i < chapters.length; i++) {
        if (position >= chapters[i].start && (!chapters[i + 1] || position < chapters[i + 1].start)) {
          foundChapter = chapters[i]
          if (chapters[i].subitems && chapters[i].subitems.length > 0) {
            return this.findChapterFromPosition(chapters[i].subitems, position, foundChapter)
          }
          break
        }
      }
      return foundChapter
    },
    /** @returns {Array} Returns an array of chapters that only includes chapters with query results */
    async searchBook(query) {
      const chapters = structuredClone(await this.chapters)
      const searchResults = await Promise.all(this.book.spine.spineItems.map((item) => item.load(this.book.load.bind(this.book)).then(item.find.bind(item, query)).finally(item.unload.bind(item))))
      const mergedResults = [].concat(...searchResults)

      mergedResults.forEach((chapter) => {
        chapter.start = this.book.locations.percentageFromCfi(chapter.cfi)
        const foundChapter = this.findChapterFromPosition(chapters, chapter.start)
        if (foundChapter) foundChapter.searchResults.push(chapter)
      })

      let filteredResults = chapters.filter(function f(o) {
        if (o.searchResults.length) return true
        if (o.subitems.length) {
          return (o.subitems = o.subitems.filter(f)).length
        }
      })
      return filteredResults
    },
    keyUp(e) {
      const rtl = this.book.package.metadata.direction === 'rtl'
      if ((e.keyCode || e.which) == 37) {
        return rtl ? this.next() : this.prev()
      } else if ((e.keyCode || e.which) == 39) {
        return rtl ? this.prev() : this.next()
      }
    },
    /**
     * @param {object} payload
     * @param {string} payload.ebookLocation - CFI of the current location
     * @param {string} payload.ebookProgress - eBook Progress Percentage
     */
    async updateProgress(payload) {
      if (!this.keepProgress) return
      const cacheOptions = { ownerId: this.offlineOwnerId(), queue: this.shouldWriteLocally() }
      if (this.offlineRecord) {
        try {
          await this.$offlineBooks.saveProgress(this.libraryItemId, this.fileId, payload, cacheOptions)
        } catch (error) {
          console.error('Failed to save offline ebook progress', error)
        }
      }
      if (this.shouldWriteLocally()) return
      this.$axios.$patch(`/api/me/progress/${this.libraryItemId}`, payload, { progress: false }).catch(async (error) => {
        console.error('EpubReader.updateProgress failed:', error)
        if (this.offlineRecord && this.canQueueFailedRequest(error)) {
          try {
            await this.$offlineBooks.saveProgress(this.libraryItemId, this.fileId, payload, { ownerId: this.offlineOwnerId(), queue: true })
          } catch (cacheError) {
            console.error('Failed to queue offline ebook progress', cacheError)
          }
        }
      })
    },
    getAllEbookLocationData() {
      const locations = []
      let totalSize = 0 // Total in bytes

      for (const key in localStorage) {
        if (!localStorage.hasOwnProperty(key) || !key.startsWith('ebookLocations-')) {
          continue
        }

        try {
          const ebookLocations = JSON.parse(localStorage[key])
          if (!ebookLocations.locations) throw new Error('Invalid locations object')

          ebookLocations.key = key
          ebookLocations.size = (localStorage[key].length + key.length) * 2
          locations.push(ebookLocations)
          totalSize += ebookLocations.size
        } catch (error) {
          console.error('Failed to parse ebook locations', key, error)
          localStorage.removeItem(key)
        }
      }

      // Sort by oldest lastAccessed first
      locations.sort((a, b) => a.lastAccessed - b.lastAccessed)

      return {
        locations,
        totalSize
      }
    },
    /** @param {string} locationString */
    checkSaveLocations(locationString) {
      const maxSizeInBytes = 3000000 // Allow epub locations to take up to 3MB of space
      const newLocationsSize = JSON.stringify({ lastAccessed: Date.now(), locations: locationString }).length * 2

      // Too large overall
      if (newLocationsSize > maxSizeInBytes) {
        console.error('Epub locations are too large to store. Size =', newLocationsSize)
        return
      }

      const ebookLocationsData = this.getAllEbookLocationData()

      let availableSpace = maxSizeInBytes - ebookLocationsData.totalSize

      // Remove epub locations until there is room for locations
      while (availableSpace < newLocationsSize && ebookLocationsData.locations.length) {
        const oldestLocation = ebookLocationsData.locations.shift()
        console.log(`Removing cached locations for epub "${oldestLocation.key}" taking up ${oldestLocation.size} bytes`)
        availableSpace += oldestLocation.size
        localStorage.removeItem(oldestLocation.key)
      }

      console.log(`Cacheing epub locations with key "${this.localStorageLocationsKey}" taking up ${newLocationsSize} bytes`)
      this.saveLocations(locationString)
    },
    /** @param {string} locationString */
    saveLocations(locationString) {
      localStorage.setItem(
        this.localStorageLocationsKey,
        JSON.stringify({
          lastAccessed: Date.now(),
          locations: locationString
        })
      )
    },
    loadLocations() {
      const locationsObjString = localStorage.getItem(this.localStorageLocationsKey)
      if (!locationsObjString) return null

      const locationsObject = JSON.parse(locationsObjString)

      // Remove invalid location objects
      if (!locationsObject.locations) {
        console.error('Invalid epub locations stored', this.localStorageLocationsKey)
        localStorage.removeItem(this.localStorageLocationsKey)
        return null
      }

      // Update lastAccessed
      this.saveLocations(locationsObject.locations)

      return locationsObject.locations
    },
    /** @param {string} location - CFI of the new location */
    relocated(location) {
      if (this.savedEbookLocation === location.start.cfi) {
        return
      }

      if (location.end.percentage) {
        this.updateProgress({
          ebookLocation: location.start.cfi,
          ebookProgress: location.end.percentage
        })
      } else {
        this.updateProgress({
          ebookLocation: location.start.cfi
        })
      }
    },
    async initEpub() {
      /** @type {EpubReader} */
      const reader = this

      // Use axios to make request because we have token refresh logic in interceptor
      const customRequest = async (url) => {
        try {
          return this.$axios.$get(url, {
            responseType: 'arraybuffer'
          })
        } catch (error) {
          console.error('EpubReader.initEpub customRequest failed:', error)
          throw error
        }
      }

      try {
        await this.refreshOfflineRecord()
      } catch (error) {
        console.error('Failed to check offline ebook storage', error)
      }

      if (this.libraryItem?._offline && !this.offlineRecord) {
        this.$toast.error('This offline book is no longer available on this device')
        return
      }

      const bookSource = this.offlineRecord?.ebookData || reader.ebookUrl
      this.usingOfflineBook = !!this.offlineRecord
      const bookOptions = {
        width: this.readerWidth,
        height: this.readerHeight - 50,
        openAs: 'epub'
      }
      if (!this.offlineRecord) bookOptions.requestMethod = customRequest

      /** @type {ePub.Book} */
      reader.book = new ePub(bookSource, bookOptions)

      /** @type {ePub.Rendition} */
      reader.rendition = reader.book.renderTo('viewer', {
        width: this.readerWidth,
        height: this.readerHeight * 0.8,
        allowScriptedContent: this.allowScriptedContent,
        spread: 'auto',
        snap: true,
        manager: 'continuous',
        flow: 'paginated'
      })

      // Register before display so the first iframe is covered as well. The
      // rendered event can occur before book.ready on fast/cacheable chapters.
      reader.rendition.hooks.content.register((contents) => {
        reader.addFastFonts(contents)
        reader.prepareIosSelection(contents)
      })

      // load saved progress
      reader.rendition.display(this.savedEbookLocation || reader.book.locations.start)

      reader.rendition.on('rendered', (section, view) => {
        this.applyTheme()
        if (view?.contents) {
          this.addFastFonts(view.contents)
          this.prepareIosSelection(view.contents)
          this.annotations.forEach((annotation) => {
            if (annotation.type !== 'bookmark' && view.contents.sectionIndex === new ePub.CFI(annotation.cfi).spinePos) {
              const color = this.annotationColorValues[annotation.color] || this.annotationColorValues.yellow
              this.renderCustomHighlight(annotation, view.contents, color)
            }
          })
        }
      })

      reader.book.ready
        .then(() => {
          // set up event listeners
          reader.rendition.on('relocated', reader.relocated)
          reader.rendition.on('keydown', reader.keyUp)
          reader.rendition.on('selected', reader.selected)

          reader.rendition.on('touchstart', (event, contents) => {
            reader.handleSelectionTouchStart(event, contents)
            this.$emit('touchstart', event)
          })
          reader.rendition.on('touchend', (event, contents) => {
            const hasSelection = reader.captureTouchSelection(contents)
            if (!hasSelection) {
              reader.scheduleTouchSelectionCapture(contents)
              this.$emit('touchend', event)
            }
          })

          // load ebook cfi locations
          const savedLocations = this.loadLocations()
          if (savedLocations) {
            reader.book.locations.load(savedLocations)
          } else {
            reader.book.locations.generate().then(() => {
              this.checkSaveLocations(reader.book.locations.save())
            })
          }
          this.getChapters()
          this.loadAnnotations()
        })
        .catch((error) => {
          console.error('EpubReader.initEpub failed:', error)
        })
    },
    getChapters() {
      // Load the list of chapters in the book. See https://github.com/futurepress/epub.js/issues/759
      const toc = this.book?.navigation?.toc || []

      const tocTree = []

      const resolveURL = (url, relativeTo) => {
        // see https://github.com/futurepress/epub.js/issues/1084
        // HACK-ish: abuse the URL API a little to resolve the path
        // the base needs to be a valid URL, or it will throw a TypeError,
        // so we just set a random base URI and remove it later
        const base = 'https://example.invalid/'
        return new URL(url, base + relativeTo).href.replace(base, '')
      }

      const basePath = this.book.packaging.navPath || this.book.packaging.ncxPath

      const createTree = async (toc, parent) => {
        const promises = toc.map(async (tocItem, i) => {
          const href = resolveURL(tocItem.href, basePath)
          const id = href.split('#')[1]
          const item = this.book.spine.get(href)
          await item.load(this.book.load.bind(this.book))
          const el = id ? item.document.getElementById(id) : item.document.body

          const cfi = item.cfiFromElement(el)

          parent[i] = {
            title: tocItem.label.trim(),
            subitems: [],
            href,
            cfi,
            start: this.book.locations.percentageFromCfi(cfi),
            end: null, // set by flattenChapters()
            id: null, // set by flattenChapters()
            searchResults: []
          }

          if (tocItem.subitems) {
            await createTree(tocItem.subitems, parent[i].subitems)
          }
        })
        await Promise.all(promises)
      }
      return createTree(toc, tocTree).then(() => {
        this.chapters = tocTree
      })
    },
    flattenChapters(chapters) {
      // Convert the nested epub chapters into something that looks like audiobook chapters for player-ui
      const unwrap = (chapters) => {
        return chapters.reduce((acc, chapter) => {
          return chapter.subitems ? [...acc, chapter, ...unwrap(chapter.subitems)] : [...acc, chapter]
        }, [])
      }
      let flattenedChapters = unwrap(chapters)

      flattenedChapters = flattenedChapters.sort((a, b) => a.start - b.start)
      for (let i = 0; i < flattenedChapters.length; i++) {
        flattenedChapters[i].id = i
        if (i < flattenedChapters.length - 1) {
          flattenedChapters[i].end = flattenedChapters[i + 1].start
        } else {
          flattenedChapters[i].end = 1
        }
      }
      return flattenedChapters
    },
    resize() {
      this.windowWidth = window.innerWidth
      this.windowHeight = window.innerHeight
      this.rendition?.resize(this.readerWidth, this.readerHeight * 0.8)
    },
    applyTheme() {
      if (!this.rendition) return
      this.rendition.getContents().forEach((c) => {
        this.addFastFonts(c)
        c.addStylesheetRules(this.themeRules)
      })
    },
    addFastFonts(contents) {
      const document = contents?.document
      if (!document?.head || document.getElementById('abs-fast-reader-fonts')) return

      const routerBasePath = String(this.$config.routerBasePath || '').replace(/\/$/, '')
      const style = document.createElement('style')
      style.id = 'abs-fast-reader-fonts'
      style.textContent = `
        @font-face {
          font-family: 'Fast Sans';
          src: url('${routerBasePath}/fonts/fast/Fast_Sans.woff2') format('woff2');
          font-style: normal;
          font-weight: 400;
          font-display: swap;
        }
        @font-face {
          font-family: 'Fast Serif';
          src: url('${routerBasePath}/fonts/fast/Fast_Serif.woff2') format('woff2');
          font-style: normal;
          font-weight: 400;
          font-display: swap;
        }
        @font-face {
          font-family: 'Fast Mono';
          src: url('${routerBasePath}/fonts/fast/Fast_Mono.woff2') format('woff2');
          font-style: normal;
          font-weight: 400;
          font-display: swap;
        }
      `
      document.head.appendChild(style)
    }
  },
  mounted() {
    this.windowWidth = window.innerWidth
    this.windowHeight = window.innerHeight
    window.addEventListener('resize', this.resize)
    this.$root.socket?.on('ebook_annotation_updated', this.annotationUpdated)
    this.$root.socket?.on('ebook_annotation_removed', this.annotationRemoved)
    window.addEventListener('book-shelf-offline-synced', this.loadAnnotations)
    this.initEpub()
    this.selectionPollInterval = setInterval(this.pollForSelection, 300)
  },
  beforeDestroy() {
    window.removeEventListener('resize', this.resize)
    this.selectionCaptureTimeouts.forEach(clearTimeout)
    clearInterval(this.selectionPollInterval)
    clearTimeout(this.selectionLongPressTimeout)
    this.$root.socket?.off('ebook_annotation_updated', this.annotationUpdated)
    this.$root.socket?.off('ebook_annotation_removed', this.annotationRemoved)
    window.removeEventListener('book-shelf-offline-synced', this.loadAnnotations)
    this.book?.destroy()
  }
}
</script>
