/**
 * keyboard_rig.js - 03 // 果蝇中枢神经运动输出与实时机械键盘拟真装置
 * 参考 FlyDino (cobanov.dev) 设计：将 16 个下行神经元 (DNs) 的解码指令映射为苍蝇肉身踏击键盘的机械动作
 */

export class KeyboardRigVisualizer {
  constructor(canvas) {
    this.canvas = canvas;
    this.ctx = canvas ? canvas.getContext('2d') : null;
    this.width = canvas ? canvas.width : 600;
    this.height = canvas ? canvas.height : 240;

    this.frame = 0;
    this.flyX = 190;
    this.flyY = 135;
    this.flyAngle = 0;
    this.wingPhase = 0;

    // 机械按键物理定义
    this.keys = {
      up: { id: 'up', label: '↑', sub: 'W', x: 190, y: 95, w: 48, h: 42, pressed: false, sink: 0 },
      left: { id: 'left', label: '←', sub: 'A', x: 134, y: 152, w: 48, h: 42, pressed: false, sink: 0 },
      down: { id: 'down', label: '↓', sub: 'S', x: 190, y: 152, w: 48, h: 42, pressed: false, sink: 0 },
      right: { id: 'right', label: '→', sub: 'D', x: 246, y: 152, w: 48, h: 42, pressed: false, sink: 0 },
      shift: { id: 'shift', label: 'SHIFT', sub: 'FOCUS', x: 345, y: 152, w: 82, h: 42, pressed: false, sink: 0 },
      z: { id: 'z', label: 'Z', sub: 'SHOT', x: 435, y: 152, w: 52, h: 42, pressed: true, sink: 0 },
      x: { id: 'x', label: 'X', sub: 'BOMB', x: 500, y: 152, w: 52, h: 42, pressed: false, sink: 0 }
    };

    // 敲击触点冲击微波
    this.ripples = [];

    // 当前遥测缓存
    this.currentCmd = { moveX: 0, moveY: 0, focusMode: false, isHuman: false };
  }

  update(motorCommand = null) {
    this.frame++;
    if (motorCommand) {
      this.currentCmd = motorCommand;
    }

    const mx = this.currentCmd.moveX || 0;
    const my = this.currentCmd.moveY || 0;
    const focus = Boolean(this.currentCmd.focusMode);

    // 1. 判断各按键按压状态 (神经阈值)
    const prevLeft = this.keys.left.pressed;
    const prevRight = this.keys.right.pressed;
    const prevUp = this.keys.up.pressed;
    const prevDown = this.keys.down.pressed;
    const prevShift = this.keys.shift.pressed;

    this.keys.left.pressed = mx < -0.15;
    this.keys.right.pressed = mx > 0.15;
    this.keys.up.pressed = my < -0.15;
    this.keys.down.pressed = my > 0.15;
    this.keys.shift.pressed = focus;
    this.keys.z.pressed = true; // 持续保持自机射击
    this.keys.x.pressed = false;

    // 触发按键下沉与冲击波
    const checkRipple = (k, prev) => {
      if (k.pressed && !prev) {
        this.ripples.push({ x: k.x, y: k.y, r: 4, alpha: 0.9 });
      }
      k.sink += ((k.pressed ? 3.5 : 0) - k.sink) * 0.35;
    };

    checkRipple(this.keys.left, prevLeft);
    checkRipple(this.keys.right, prevRight);
    checkRipple(this.keys.up, prevUp);
    checkRipple(this.keys.down, prevDown);
    checkRipple(this.keys.shift, prevShift);
    this.keys.z.sink = 2.0 + Math.sin(this.frame * 0.4) * 1.5;

    // 更新冲击波粒子
    for (let i = this.ripples.length - 1; i >= 0; i--) {
      const rip = this.ripples[i];
      rip.r += 1.8;
      rip.alpha -= 0.08;
      if (rip.alpha <= 0) {
        this.ripples.splice(i, 1);
      }
    }

    // 2. 果蝇身体中心平滑位移与姿态平滑解算
    // 居中基准点处于方向键十字中心 (190, 135)
    let targetX = 190 + mx * 38;
    let targetY = 135 + my * 26;

    if (focus) {
      // 开启慢速专注时，苍蝇略微向右倾身踏住 SHIFT 键
      targetX = targetX * 0.7 + 240 * 0.3;
    }

    this.flyX += (targetX - this.flyX) * 0.22;
    this.flyY += (targetY - this.flyY) * 0.22;

    // 身体转向角度响应水平转向
    const targetAngle = mx * 0.35;
    this.flyAngle += (targetAngle - this.flyAngle) * 0.2;

    // 翅膀振动相位 (移动时剧烈振颤)
    const speed = Math.hypot(mx, my);
    this.wingPhase += 0.4 + speed * 0.8;
  }

  render() {
    if (!this.ctx) return;
    const ctx = this.ctx;
    const w = this.width;
    const h = this.height;

    ctx.clearRect(0, 0, w, h);

    // 1. 现代深灰蓝底板与极微刻度网格
    ctx.fillStyle = '#181B26';
    ctx.fillRect(0, 0, w, h);

    // 仪器微刻度网格
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.025)';
    ctx.lineWidth = 1;
    for (let x = 0; x < w; x += 30) {
      ctx.beginPath();
      ctx.moveTo(x, 0);
      ctx.lineTo(x, h);
      ctx.stroke();
    }

    // 顶端仪器标头
    ctx.font = '10px "JetBrains Mono", monospace';
    ctx.fillStyle = '#8b95a5';
    ctx.textAlign = 'left';
    ctx.fillText('03 // MOTOR ACTUATION RIG · PHYSICAL KEYBOARD OUTPUT', 16, 20);

    const isHuman = Boolean(this.currentCmd.isHuman);
    ctx.textAlign = 'right';
    ctx.fillStyle = isHuman ? '#e5e7eb' : '#4ade80';
    ctx.fillText(
      isHuman ? 'INPUT SOURCE: MANUAL KEYBOARD' : 'INPUT SOURCE: MALECNS DN-READOUT',
      w - 16,
      20
    );

    // 柔和微弱分隔基线
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.04)';
    ctx.beginPath();
    ctx.moveTo(12, 28);
    ctx.lineTo(w - 12, 28);
    ctx.stroke();

    // 2. 绘制机械键帽底座与键面
    Object.values(this.keys).forEach(k => {
      this.drawKeycap(ctx, k);
    });

    // 3. 绘制按键冲击波
    this.ripples.forEach(rip => {
      ctx.beginPath();
      ctx.arc(rip.x, rip.y, rip.r, 0, Math.PI * 2);
      ctx.strokeStyle = `rgba(74, 222, 128, ${rip.alpha})`;
      ctx.lineWidth = 1.2;
      ctx.stroke();
    });

    // 4. 绘制果蝇肉身踏击物理按键 (生物解剖拓扑)
    this.drawFly(ctx, this.flyX, this.flyY, this.flyAngle);

    // 5. 底部实时运动指令遥测条
    ctx.font = '10px "JetBrains Mono", monospace';
    ctx.fillStyle = '#6b7280';
    ctx.textAlign = 'left';
    const mxStr = (this.currentCmd.moveX || 0).toFixed(2);
    const myStr = (this.currentCmd.moveY || 0).toFixed(2);
    const focusStr = this.currentCmd.focusMode ? 'ON' : 'OFF';

    ctx.fillText(
      `ACTUATOR READOUT // X: ${mxStr} | Y: ${myStr} | FOCUS: ${focusStr} | FIRE: ON`,
      16,
      h - 12
    );

    ctx.textAlign = 'right';
    ctx.fillStyle = '#4ade80';
    ctx.fillText('60HZ SYNC // 0-LATENCY', w - 16, h - 12);
  }

  drawKeycap(ctx, k) {
    const sink = k.sink || 0;
    const isPressed = k.pressed;
    const x = k.x - k.w / 2;
    const y = k.y - k.h / 2;

    // 机械轴体基座阴影 (带微弱立体感)
    ctx.fillStyle = '#10131d';
    ctx.fillRect(x, y + 4, k.w, k.h);

    // 轴体边框 (极其微弱内透)
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.04)';
    ctx.lineWidth = 1;
    ctx.strokeRect(x, y + 4, k.w, k.h);

    // 移动的键帽上表面 (按压时下沉 sink 像素)
    const capY = y + sink;
    ctx.fillStyle = isPressed ? '#232b3b' : '#1c2230';
    ctx.fillRect(x, capY, k.w, k.h);

    ctx.strokeStyle = isPressed ? '#4ade80' : 'rgba(255, 255, 255, 0.08)';
    ctx.lineWidth = isPressed ? 1.5 : 1;
    ctx.strokeRect(x, capY, k.w, k.h);

    // 键帽字符
    ctx.font = 'bold 12px "JetBrains Mono", monospace';
    ctx.fillStyle = isPressed ? '#4ade80' : '#e2e8f0';
    ctx.textAlign = 'center';
    ctx.fillText(k.label, k.x, capY + k.h / 2 - 2);

    // 键帽副标 (W/A/S/D / 功能名)
    ctx.font = '8px "JetBrains Mono", monospace';
    ctx.fillStyle = isPressed ? '#86efac' : '#8b95a5';
    ctx.fillText(k.sub, k.x, capY + k.h / 2 + 10);
  }

  drawFly(ctx, x, y, angle) {
    ctx.save();
    ctx.translate(x, y);
    ctx.rotate(angle);

    const mx = this.currentCmd.moveX || 0;
    const my = this.currentCmd.moveY || 0;
    const focus = Boolean(this.currentCmd.focusMode);

    // 1. 六条生物关节腿 (基节 Coxa -> 股节 Femur -> 胫节 Tibia -> 跗节 Tarsus)
    ctx.strokeStyle = '#9ca3af';
    ctx.lineWidth = 1.4;
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';

    // 左前腿 (向左前方伸出，负责拍按 LEFT 或 UP)
    ctx.beginPath();
    ctx.moveTo(-5, -6);
    ctx.lineTo(-24 + (mx < -0.1 ? -12 : 0), -20 + (my < -0.1 ? -12 : 0));
    ctx.lineTo(-38 + (mx < -0.1 ? -18 : 0), -24 + (my < -0.1 ? -8 : 0));
    ctx.stroke();

    // 爪垫接触点
    ctx.fillStyle = mx < -0.1 ? '#4ade80' : '#6b7280';
    ctx.beginPath();
    ctx.arc(-38 + (mx < -0.1 ? -18 : 0), -24 + (my < -0.1 ? -8 : 0), 2.2, 0, Math.PI * 2);
    ctx.fill();

    // 右前腿 (向右前方伸出，负责拍按 RIGHT 或 UP)
    ctx.beginPath();
    ctx.moveTo(5, -6);
    ctx.lineTo(24 + (mx > 0.1 ? 12 : 0), -20 + (my < -0.1 ? -12 : 0));
    ctx.lineTo(38 + (mx > 0.1 ? 18 : 0), -24 + (my < -0.1 ? -8 : 0));
    ctx.stroke();

    ctx.fillStyle = mx > 0.1 ? '#4ade80' : '#6b7280';
    ctx.beginPath();
    ctx.arc(38 + (mx > 0.1 ? 18 : 0), -24 + (my < -0.1 ? -8 : 0), 2.2, 0, Math.PI * 2);
    ctx.fill();

    // 左中腿 (横向支撑)
    ctx.beginPath();
    ctx.moveTo(-6, 2);
    ctx.lineTo(-30, 4);
    ctx.lineTo(-44 + (mx < -0.15 ? -14 : 0), 12);
    ctx.stroke();

    ctx.fillStyle = mx < -0.15 ? '#4ade80' : '#6b7280';
    ctx.beginPath();
    ctx.arc(-44 + (mx < -0.15 ? -14 : 0), 12, 2.0, 0, Math.PI * 2);
    ctx.fill();

    // 右中腿 (横向支撑，按 Shift 专注时向右大幅延展)
    ctx.beginPath();
    ctx.moveTo(6, 2);
    ctx.lineTo(30 + (focus ? 24 : 0), 4);
    ctx.lineTo(44 + (focus ? 42 : 0), 12 + (focus ? 6 : 0));
    ctx.stroke();

    ctx.fillStyle = (mx > 0.15 || focus) ? '#4ade80' : '#6b7280';
    ctx.beginPath();
    ctx.arc(44 + (focus ? 42 : 0), 12 + (focus ? 6 : 0), 2.0, 0, Math.PI * 2);
    ctx.fill();

    // 左后腿 (后方抓地，负责 DOWN 按压)
    ctx.beginPath();
    ctx.moveTo(-5, 12);
    ctx.lineTo(-24, 26);
    ctx.lineTo(-32, 40 + (my > 0.1 ? 12 : 0));
    ctx.stroke();

    ctx.fillStyle = my > 0.1 ? '#4ade80' : '#6b7280';
    ctx.beginPath();
    ctx.arc(-32, 40 + (my > 0.1 ? 12 : 0), 2.0, 0, Math.PI * 2);
    ctx.fill();

    // 右后腿 (后方抓地)
    ctx.beginPath();
    ctx.moveTo(5, 12);
    ctx.lineTo(24, 26);
    ctx.lineTo(32, 40 + (my > 0.1 ? 12 : 0));
    ctx.stroke();

    ctx.fillStyle = my > 0.1 ? '#4ade80' : '#6b7280';
    ctx.beginPath();
    ctx.arc(32, 40 + (my > 0.1 ? 12 : 0), 2.0, 0, Math.PI * 2);
    ctx.fill();

    // 2. 腹部 (Abdomen) - 具背板分节黑黄纹理
    ctx.fillStyle = '#b45309';
    ctx.beginPath();
    ctx.ellipse(0, 16, 7.5, 14, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = '#1f2937';
    ctx.lineWidth = 1;
    ctx.stroke();

    // 腹部横纹 (Tergites)
    ctx.strokeStyle = '#78350f';
    ctx.lineWidth = 1.2;
    for (let sy = 8; sy <= 24; sy += 4) {
      ctx.beginPath();
      ctx.moveTo(-6, sy);
      ctx.lineTo(6, sy);
      ctx.stroke();
    }

    // 3. 胸部 (Thorax) - 盾片与鬃毛纹理
    ctx.fillStyle = '#d97706';
    ctx.beginPath();
    ctx.ellipse(0, 0, 8.5, 9, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = '#1f2937';
    ctx.lineWidth = 1;
    ctx.stroke();

    // 4. 双翅 (Wings) - 半透明膜质与翅脉
    const wingFlap = Math.sin(this.wingPhase) * 0.18;

    // 左翅
    ctx.save();
    ctx.translate(-3, -2);
    ctx.rotate(-0.35 + wingFlap);
    ctx.fillStyle = 'rgba(243, 244, 246, 0.42)';
    ctx.strokeStyle = 'rgba(156, 163, 175, 0.6)';
    ctx.lineWidth = 0.8;
    ctx.beginPath();
    ctx.ellipse(-12, 16, 7, 20, -0.2, 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();
    // 翅脉
    ctx.beginPath();
    ctx.moveTo(0, 0);
    ctx.lineTo(-12, 28);
    ctx.stroke();
    ctx.restore();

    // 右翅
    ctx.save();
    ctx.translate(3, -2);
    ctx.rotate(0.35 - wingFlap);
    ctx.fillStyle = 'rgba(243, 244, 246, 0.42)';
    ctx.strokeStyle = 'rgba(156, 163, 175, 0.6)';
    ctx.lineWidth = 0.8;
    ctx.beginPath();
    ctx.ellipse(12, 16, 7, 20, 0.2, 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();
    // 翅脉
    ctx.beginPath();
    ctx.moveTo(0, 0);
    ctx.lineTo(12, 28);
    ctx.stroke();
    ctx.restore();

    // 5. 头部 (Head) 与红色复眼 (Compound Eyes)
    ctx.fillStyle = '#92400e';
    ctx.beginPath();
    ctx.ellipse(0, -11, 7, 5, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = '#1f2937';
    ctx.lineWidth = 1;
    ctx.stroke();

    // 左右巨大红色复眼 (经典黑腹果蝇特征)
    ctx.fillStyle = '#dc2626';
    ctx.beginPath();
    ctx.ellipse(-6, -11, 3.2, 4.2, -0.2, 0, Math.PI * 2);
    ctx.fill();
    ctx.beginPath();
    ctx.ellipse(6, -11, 3.2, 4.2, 0.2, 0, Math.PI * 2);
    ctx.fill();

    // 触角 (Antennae)
    ctx.strokeStyle = '#4b5563';
    ctx.lineWidth = 0.8;
    ctx.beginPath();
    ctx.moveTo(-2, -15);
    ctx.lineTo(-4, -19);
    ctx.moveTo(2, -15);
    ctx.lineTo(4, -19);
    ctx.stroke();

    ctx.restore();
  }
}
