export default function ({ store, redirect, route, app }) {
  // If the user is not authenticated
  if (!store.state.user.user) {
    if (process.client && !navigator.onLine && !route.path.startsWith('/offline')) {
      return redirect('/offline/')
    }
    if (route.name === 'batch' || route.name === 'index') {
      return redirect('/login')
    }
    return redirect(`/login?redirect=${encodeURIComponent(route.fullPath)}`)
  }
}
