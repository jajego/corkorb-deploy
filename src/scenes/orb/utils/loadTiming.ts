// User Timing entries are available in browser DevTools, including production builds.
const stages = new Set<string>()
let started: number | undefined

export function beginPaperLoadTiming() {
  stages.clear()
  started = performance.now()
  for (const entry of performance.getEntriesByType('measure')) {
    if (entry.name.startsWith('corkorb:')) performance.clearMeasures(entry.name)
  }
}

export function markPaperLoadStage(stage: string) {
  if (started === undefined || stages.has(stage)) return
  stages.add(stage)
  performance.measure(`corkorb:${stage}`, { start: started, end: performance.now() })
}
