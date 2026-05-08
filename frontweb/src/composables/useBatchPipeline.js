import { ref } from 'vue'

/**
 * 批量生成调度器：N 个 worker 并发消费一个候选队列
 *
 * 用法：
 *   const pipe = createBatchPool({ concurrency: 5 })
 *   pipe.setItems(items)
 *   await pipe.run(async (item) => {
 *     // 单个任务实现：成功 → resolve；失败 → throw 或返回 { ok:false, error }
 *   }, { onItemDone: (item, result) => { ... } })
 *
 * 暴露的响应式状态（用于 UI 进度条）：
 *   total / done / failed / running / stopping
 *
 * 停止语义：调用 stop() 后，未出队的不再执行；已在跑的等其结束。
 */
export function createBatchPool(opts = {}) {
  const concurrency = Math.max(1, Number(opts.concurrency) || 5)

  const total = ref(0)
  const done = ref(0)
  const failed = ref(0)
  const running = ref(false)
  const stopping = ref(false)

  let items = []
  let queueIdx = 0

  function setItems(list) {
    items = Array.isArray(list) ? list.slice() : []
    total.value = items.length
    done.value = 0
    failed.value = 0
    queueIdx = 0
  }

  function stop() {
    if (running.value) stopping.value = true
  }

  /** task: 单个任务 async 函数，return { ok:true } / { ok:false, error } 或 throw */
  async function run(task, hooks = {}) {
    if (running.value) return
    running.value = true
    stopping.value = false
    try {
      const worker = async () => {
        while (queueIdx < items.length) {
          if (stopping.value) break
          const item = items[queueIdx++]
          let result
          try {
            const r = await task(item)
            result = r && typeof r === 'object' ? r : { ok: true }
          } catch (e) {
            result = { ok: false, error: e?.message || String(e) }
          }
          if (!result.ok) failed.value += 1
          done.value += 1
          try {
            hooks.onItemDone?.(item, result)
          } catch (_) {}
        }
      }
      await Promise.allSettled(
        Array.from({ length: Math.min(concurrency, items.length) }, () => worker())
      )
    } finally {
      running.value = false
      stopping.value = false
    }
  }

  return { total, done, failed, running, stopping, setItems, stop, run }
}

/**
 * 流水管道：上游生产（生成池），每完成一个就 push 给下游（审核池），互不阻塞
 *
 * 调用方：
 *   const pipe = createReviewPipeline({ concurrency: 5 })
 *   pipe.start(async (id) => { ... })   // 开始消费（不等所有 push 完成才启动）
 *   for (...) { pipe.push(id) }
 *   pipe.close()                         // 标记不会再有新 item
 *   await pipe.done()                    // 等所有 worker 把队列清空
 *   pipe.stop()                          // 中断：未出队的丢弃
 */
export function createReviewPipeline(opts = {}) {
  const concurrency = Math.max(1, Number(opts.concurrency) || 5)

  const enqueued = ref(0)
  const done = ref(0)
  const failed = ref(0)
  const running = ref(false)
  const stopping = ref(false)

  const queue = []
  let closed = false
  let waiters = []
  let workers = []
  let allWorkersDone = null

  function notifyWaiters() {
    const list = waiters
    waiters = []
    list.forEach((fn) => fn())
  }

  function push(item) {
    if (closed || stopping.value) return
    queue.push(item)
    enqueued.value += 1
    notifyWaiters()
  }

  function close() {
    closed = true
    notifyWaiters()
  }

  function stop() {
    stopping.value = true
    queue.length = 0
    closed = true
    notifyWaiters()
  }

  /** 等所有 worker 退出（队列清空 + closed）*/
  async function waitDone() {
    if (!running.value) return
    if (allWorkersDone) await allWorkersDone
  }

  /** 开始 N 个 worker。reviewFn(item) 同 createBatchPool.task 协议 */
  function start(reviewFn, hooks = {}) {
    if (running.value) return
    running.value = true
    stopping.value = false
    closed = false

    const worker = async () => {
      while (true) {
        if (stopping.value) return
        if (queue.length === 0) {
          if (closed) return
          await new Promise((resolve) => waiters.push(resolve))
          continue
        }
        const item = queue.shift()
        let result
        try {
          const r = await reviewFn(item)
          result = r && typeof r === 'object' ? r : { ok: true }
        } catch (e) {
          result = { ok: false, error: e?.message || String(e) }
        }
        if (!result.ok) failed.value += 1
        done.value += 1
        try {
          hooks.onItemDone?.(item, result)
        } catch (_) {}
      }
    }

    workers = Array.from({ length: concurrency }, () => worker())
    allWorkersDone = Promise.allSettled(workers).finally(() => {
      running.value = false
      stopping.value = false
    })
  }

  return { enqueued, done, failed, running, stopping, push, close, stop, waitDone, start }
}
