// 通用「正在生成…已 X分Y秒…」耗时显示 composable
// 用法：
//   const timer = useElapsedTimer()
//   timer.start(key)              // 开始计时
//   timer.startAt(key, msTimestamp) // 用已有起始时间（用于刷新页面恢复）
//   timer.stop(key)               // 结束计时
//   timer.text(key)               // 模板里调用，得到 "12秒" / "1分20秒"
//   timer.has(key)                // 是否有计时
//
// key 可以是任意值（数字 id / 字符串 / 字面量），同一个 timer 实例可管多个 key
//
// 全局 ticker：所有 timer 实例共享一个 1s ticker；无活跃 key 时自动停止
import { ref, reactive } from 'vue'

const _nowTick = ref(Date.now())
const _activeKeys = new Set() // 全局所有活跃 key 的引用集合（每个实例 push 自己的 key 进来）
let _timerHandle = null

function _ensureTicker() {
  if (_timerHandle) return
  _timerHandle = setInterval(() => { _nowTick.value = Date.now() }, 1000)
}
function _stopTickerIfIdle() {
  if (_activeKeys.size === 0 && _timerHandle) {
    clearInterval(_timerHandle)
    _timerHandle = null
  }
}

export function useElapsedTimer() {
  const startMap = reactive(new Map()) // key → ms timestamp

  function start(key) {
    if (key == null) return
    if (!startMap.has(key)) {
      startMap.set(key, Date.now())
      _activeKeys.add(`${Math.random()}_${key}`)
      _ensureTicker()
    }
  }

  function startAt(key, msTimestamp) {
    if (key == null) return
    const ms = Number(msTimestamp)
    if (!Number.isFinite(ms)) return start(key)
    if (!startMap.has(key)) {
      startMap.set(key, ms)
      _activeKeys.add(`${Math.random()}_${key}`)
      _ensureTicker()
    }
  }

  function stop(key) {
    if (key == null) return
    if (startMap.has(key)) {
      startMap.delete(key)
      // 清掉一个对应的 activeKey 记号
      for (const k of _activeKeys) {
        if (k.endsWith(`_${key}`)) {
          _activeKeys.delete(k)
          break
        }
      }
      _stopTickerIfIdle()
    }
  }

  function clear() {
    for (const key of [...startMap.keys()]) stop(key)
  }

  function has(key) {
    return startMap.has(key)
  }

  function text(key) {
    const startAt = startMap.get(key)
    if (!startAt) return ''
    void _nowTick.value
    const sec = Math.max(0, Math.floor((Date.now() - startAt) / 1000))
    const m = Math.floor(sec / 60)
    const s = sec % 60
    return m > 0 ? `${m}分${s}秒` : `${s}秒`
  }

  return { start, startAt, stop, clear, has, text }
}
