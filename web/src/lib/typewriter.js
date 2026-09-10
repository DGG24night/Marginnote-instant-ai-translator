import { useEffect, useRef, useState } from "react";

// 打字机平滑：插件侧流式文本按 80ms 合帧推送（一次可能蹦出十来个字），观感一顿一顿；
// 这里把「目标文本」按固定节拍逐字揭示——每拍追上当前积压的一个比例（弹性追赶），
// 既保持连续的打字节奏，又不会明显落后于模型生成速度。
// animate=false（设置关闭 / 非流式阶段）时直接透传目标文本（原行为）。
// 只做展示平滑：调用方的原始文本（复制 / 建卡 / 存档）不受影响。
const TICK_MS = 33;     // ~30fps：肉眼已连续，比 60fps 省 CPU
const CATCHUP_MS = 160; // 追赶时间常数：每拍追赶积压的 dt/CATCHUP_MS（≥1 字）

export function useTypewriterText(target, animate) {
  const [shown, setShown] = useState(target);
  const shownRef = useRef(target);
  const targetRef = useRef(target);
  const timerRef = useRef(null);
  const lastTickRef = useRef(0);
  targetRef.current = target;

  useEffect(() => {
    const apply = (text) => {
      shownRef.current = text;
      setShown(text);
    };
    const stop = () => {
      if (timerRef.current) {
        clearInterval(timerRef.current);
        timerRef.current = null;
      }
    };

    // 直通：关闭开关 / 文本回退（新任务 reset、历史切换、重试）→ 立即对齐，不做动画
    if (!animate || target.length < shownRef.current.length || !target.startsWith(shownRef.current)) {
      stop();
      apply(target);
      return;
    }
    // 已对齐或正在追赶：定时器不重建（target 每 80ms 更新一次，重建会退化成整块显示）
    if (target.length === shownRef.current.length || timerRef.current) return;

    lastTickRef.current = Date.now();
    timerRef.current = setInterval(() => {
      const t = targetRef.current;
      const backlog = t.length - shownRef.current.length;
      if (backlog <= 0) {
        stop();
        return;
      }
      // 步长按「实际间隔 / 追赶时间常数」计算：tick 被主线程渲染任务推迟、
      // 或 WebView 低功耗节流时按比例多补，避免显示明显落后于真实生成速度。
      const now = Date.now();
      const ratio = Math.min(1, (now - lastTickRef.current) / CATCHUP_MS);
      lastTickRef.current = now;
      apply(t.slice(0, shownRef.current.length + Math.max(1, Math.ceil(backlog * ratio))));
    }, TICK_MS);
  }, [target, animate]);

  useEffect(() => () => {
    if (timerRef.current) {
      clearInterval(timerRef.current);
      timerRef.current = null; // 置空避免重挂载后读到失效的计时器 id 而不再启动
    }
  }, []);

  return animate ? shown : target;
}
