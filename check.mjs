// 体检：连不上就自愈重建会话
import {connect, recover} from './dev.mjs';
try {
  await connect();
  console.log('OK');
  process.exit(0);
} catch (e) {
  console.log('会话异常:', e.message, '→ 尝试重建');
  const ok = await recover();
  console.log(ok ? '已重建 OK' : '重建失败');
  process.exit(ok ? 0 : 1);
}
