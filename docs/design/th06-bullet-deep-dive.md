# 东方红魔乡（th06）弹幕系统深度逆向报告

> 源仓库：`GensokyoClub/th06`（HEAD = `bd90685fa40eaf2e16789dcf788843b304e6e02d`），reccmp 对齐的还原工程，逐行还原 exe 原始逻辑。
> 行号引用基于本次拉取的对应 commit 文件内容。
> 问题清单：① 弹幕类型/精灵如何选定 ② 运动模型（弹速与角度换算） ③ 渲染管线与混合状态 ④ 屏幕坐标换算链（含 z 项与 0.0026041667 之谜） ⑤ 状态机、擦弹、特殊 flag 与已知 bug。

---

## 0. 全景图（先给结论）

```
ECL 字节码 ──EclManager::RunEcl──▶ Enemy::bulletProps (EnemyBulletShooter)
                                        │ SpawnBulletPattern (双层循环 count2×count1)
                                        ▼
                              BulletManager::SpawnSingleBullet
                                ├─ 弹体模板拷贝 bulletTypeTemplates[spr]（5 个 VM）
                                ├─ 精灵变体 SetActiveSprite(base + col)（16px/32px 查表换色）
                                └─ aimMode switch → 初速 (cos a, sin a) × speed
                                        │
            每帧 BulletManager::OnUpdate │（exFlags 转向/加减速、越界 culling、擦弹、碰撞）
                                        ▼
            每帧 BulletManager::OnDraw（按精灵高度分 4 桶 + RING_BALL/BALL 拆层）
                                        ▼
        AnmManager::Draw2（硬件 VP）／ Draw+DrawNoRotation（软件 VP，手工投影）
                                        ▼
   D3D8：视口=(32,16,384,448)，30°透视（世界单位≙1像素），
        COLOROP=TEXTURE×TFACTOR，DESTBLEND 按 blendMode 切换
```

弹、物品、激光、特效弹（etama.etama 系统）全部共用 `AnmVm` 虚拟机 + ANM 脚本/精灵表，这就是「同一套 VM 脚本系统」。

---

## 1. 弹幕类型（spr）与精灵编号（col）的选定 —— ECL→模板→换色

### 1.1 ECL 发弹指令：一条 handler 覆盖 9 种弹型

`src/EclManager.cpp:361` —— 所有普通发弹 opcode 共享同一个 case 块，`aimMode` 直接用 opcode 差值表达：

```cpp
case ECL_OPCODE_BULLETFANAIMED:
case ECL_OPCODE_BULLETFAN:
case ECL_OPCODE_BULLETCIRCLEAIMED:
case ECL_OPCODE_BULLETCIRCLE:
case ECL_OPCODE_BULLETOFFSETCIRCLEAIMED:
case ECL_OPCODE_BULLETOFFSETCIRCLE:
case ECL_OPCODE_BULLETRANDOMANGLE:
case ECL_OPCODE_BULLETRANDOMSPEED:
case ECL_OPCODE_BULLETRANDOM:
    local_54 = &instruction->args.bullet;
    local_58 = &enemy->bulletProps;
    local_58->sprite = local_54->sprite;                              // ← 弹幕种类 0..9
    local_58->aimMode = instruction->opCode - ECL_OPCODE_BULLETFANAIMED;
    local_58->count1 = *EnemyEclInstr::GetVar(enemy, &local_54->count1, NULL);
    local_58->count1 += enemy->BulletRankAmount1(g_GameManager.rank); // 数量随难度(rank)上浮
    if (local_58->count1 <= 0) { local_58->count1 = 1; }
    local_58->count2 = *EnemyEclInstr::GetVar(enemy, &local_54->count2, NULL);
    local_58->count2 += enemy->BulletRankAmount2(g_GameManager.rank);
    if (local_58->count2 <= 0) { local_58->count2 = 1; }
    local_58->position = enemy->position + enemy->shootOffset;
    local_58->angle1 = *EnemyEclInstr::GetVarFloat(enemy, &local_54->angle1, NULL);
    local_58->angle1 = utils::AddNormalizeAngle(local_58->angle1, 0.0f);
    local_58->speed1 = *EnemyEclInstr::GetVarFloat(enemy, &local_54->speed1, NULL);
    if (local_58->speed1 != 0.0f)
    {
        local_58->speed1 += enemy->BulletRankSpeed(g_GameManager.rank);
        if (local_58->speed1 < 0.3f) { local_58->speed1 = 0.3; }
    }
    local_58->angle2 = *EnemyEclInstr::GetVarFloat(enemy, &local_54->angle2, NULL);
    local_58->speed2 = *EnemyEclInstr::GetVarFloat(enemy, &local_54->speed2, NULL);
    local_58->speed2 += enemy->BulletRankSpeed(g_GameManager.rank) / 2.0f;
    if (local_58->speed2 < 0.3f) { local_58->speed2 = 0.3f; }
    local_58->unk_4a = 0;
    local_58->flags = local_54->flags;
    local_14 = local_54->color;                                       // ← ECL 里的“col”字段
    // TODO: Strict aliasing rule be like.
    local_58->spriteOffset = *EnemyEclInstr::GetVar(enemy, (EclVarId *)&local_14, NULL);
    if (enemy->flags.shootingDisabled == 0)
    {
        g_BulletManager.SpawnBulletPattern(local_58);
    }
    break;
```

要点：

1. **ECL 的 `color` 字段 ≙ `spriteOffset`（精灵变体/换色索引）**。它经 `EnemyEclInstr::GetVar` 处理——该函数支持「变量引用」语义：参数若是负数 var-id（`ECL_VAR_I32_0..3 / F32_0..3` 等）就取敌人变量当前值，否则把字面值本身当指针返回（即字面数字原样透传）。这就是弹幕颜色/样式可以被 `ECL_SetVar` 动态控制、进而被 `AnmOpcode_Fade`/`SetColor` 逐帧插值的底层通道。
2. 数量、速度在运行时按难度 rank 修正：`BulletRankAmount1/2`（数量）、`BulletRankSpeed`（速度，最低 0.3）。
3. `SHOOTNOW`（`EclManager.cpp:451`）复用上次参数：刷新 `position = enemy->position + enemy->shootOffset` 后再 `SpawnBulletPattern`。
4. 弹的附加行为参数由 `ECL_OPCODE_BULLETEFFECTS` 写入 `bulletProps->exInts[]/exFloats[]`（见 §5 的 exFlags）。

ECL 弹型编号常量表（`src/AnmIdx.hpp`，脚本 = 0x200+编号，故 ECL spr 直接 = 脚本号）：

```cpp
#define ANM_OFFSET_BULLET3 0x200
#define ANM_OFFSET_BULLET4 0x29a

#define ANM_SCRIPT_BULLET3_START ANM_OFFSET_BULLET3
#define ANM_SCRIPT_BULLET3_PELLET     (ANM_SCRIPT_BULLET3_START + 0)   // 0x200 豆
#define ANM_SCRIPT_BULLET3_RING_BALL  (ANM_SCRIPT_BULLET3_START + 1)   // 0x201 中玉
#define ANM_SCRIPT_BULLET3_RICE       (ANM_SCRIPT_BULLET3_START + 2)   // 0x202 米粒
#define ANM_SCRIPT_BULLET3_BALL       (ANM_SCRIPT_BULLET3_START + 3)   // 0x203 大玉
#define ANM_SCRIPT_BULLET3_KUNAI      (ANM_SCRIPT_BULLET3_START + 4)   // 0x204 苦无
#define ANM_SCRIPT_BULLET3_SHARD      (ANM_SCRIPT_BULLET3_START + 5)   // 0x205 幽灵/三角
#define ANM_SCRIPT_BULLET3_BIG_BALL   (ANM_SCRIPT_BULLET3_START + 6)   // 0x206 极玉
#define ANM_SCRIPT_BULLET3_FIREBALL   (ANM_SCRIPT_BULLET3_START + 7)   // 0x207 火球
#define ANM_SCRIPT_BULLET3_DAGGER     (ANM_SCRIPT_BULLET3_START + 8)   // 0x208 短剑(幽曲/妖骑用)
#define ANM_SCRIPT_BULLET3_LASER      (ANM_SCRIPT_BULLET3_START + 9)   // 0x209 激光
#define ANM_SCRIPT_BULLET3_SPAWN_DONUT_SMALL   (… + 11)  // 0x20b 消弹「甜甜圈」小
#define ANM_SCRIPT_BULLET3_SPAWN_DONUT_MEDIUM  (… + 12)  // 0x20c
#define ANM_SCRIPT_BULLET3_SPAWN_DONUT_BIG     (… + 13)  // 0x20d
#define ANM_SCRIPT_BULLET3_SPAWN_PELLET_FAST   (… + 14)  // 0x20e 出弹(快速) 小玉系
#define ANM_SCRIPT_BULLET3_SPAWN_PELLET_NORMAL (… + 15)  // 0x20f
#define ANM_SCRIPT_BULLET3_SPAWN_PELLET_SLOW   (… + 16)  // 0x210
#define ANM_SCRIPT_BULLET3_SPAWN_BIG_BALL_FAST (… + 17)  // 0x211 出弹(快速) 球/针/碎片系
#define ANM_SCRIPT_BULLET3_SPAWN_BIG_BALL_NORMAL (…)     // 0x212
#define ANM_SCRIPT_BULLET3_SPAWN_BIG_BALL_SLOW   (…)     // 0x213
#define ANM_SCRIPT_BULLET3_SPAWN_BIG_BALL_HUGE   (… + 20)// 0x214 出弹 极玉/火球/短剑
#define ANM_SCRIPT_BULLET3_ITEMS_START (ANM_SCRIPT_BULLET3_START + 21) // 0x215 起为物品脚本
#define ANM_SCRIPT_BULLET4_START ANM_OFFSET_BULLET4      // 0x29a
#define ANM_SCRIPT_BULLET4_BUBBLE   (ANM_SCRIPT_BULLET4_START + 0)      // 0x29a 水泡
#define ANM_SCRIPT_BULLET4_SPAWN_BUBBLE_NORMAL (… + 1)   // 0x29b
#define ANM_SCRIPT_BULLET4_SPAWN_BUBBLE_SLOW   (… + 2)   // 0x29c
```

注意 0x20a（脚本号 +10）不存在于常量表——etama3.anm 的脚本 10 未被使用，故常量直接跳到 +11。

### 1.2 五种 VM 模板：`g_BulletTypeInfos`（「弹体/出弹快/中/慢/消弹」）

`src/BulletManager.cpp:25` 起。每种弹有 **5 个 VM 模板**：本体 + 出弹特效(快/中/慢) + 消弹甜甜圈。颜色表 + 变体查表 + 模板表：

```cpp
DIFFABLE_STATIC_ARRAY_ASSIGN(u32, 28, g_EffectsColorWithTextureBlending) = {
    0xff000000, 0xff303030, 0xff606060, 0xff500000, 0xff900000, 0xffff2020, 0xff400040,
    0xff800080, 0xffff30ff, 0xff000050, 0xff000090, 0xff2020ff, 0xff203060, 0xff304090,
    0xff3080ff, 0xff005000, 0xff009000, 0xff20ff20, 0xff206000, 0xff409010, 0xff80ff20,
    0xff505000, 0xff909000, 0xffffff20, 0xff603000, 0xff904010, 0xfff08020, 0xffffffff};
DIFFABLE_STATIC_ARRAY_ASSIGN(u32, 28, g_EffectsColorWithoutTextureBlending) = { /* 近白 28 色 */ };
DIFFABLE_STATIC_ARRAY_ASSIGN(u32, 16, g_BulletSpriteOffset16Px) = {0, 1, 1, 1, 1, 2, 2, 2, 2, 3, 3, 3, 4, 4, 4, 0};
DIFFABLE_STATIC_ARRAY_ASSIGN(u32, 8,  g_BulletSpriteOffset32Px)  = {0, 1, 1, 2, 2, 3, 4, 0};
DIFFABLE_STATIC_ASSIGN(u32 *, g_EffectsColor) = g_EffectsColorWithTextureBlending;

struct BulletTypeInfo
{
    u32 bulletAnmScriptIdx;
    u32 bulletSpawnEffectFastAnmScriptIdx;
    u32 bulletSpawnEffectNormalAnmScriptIdx;
    u32 bulletSpawnEffectSlowAnmScriptIdx;
    u32 bulletSpawnEffectDonutAnmScriptIdx;
};
#define ASB3(x) ANM_SCRIPT_BULLET3_##x
#define ASB4(x) ANM_SCRIPT_BULLET4_##x
DIFFABLE_STATIC_ARRAY_ASSIGN(BulletTypeInfo, 10, g_BulletTypeInfos) = {
    {ASB3(PELLET),     ASB3(SPAWN_PELLET_FAST),  ASB3(SPAWN_PELLET_NORMAL), ASB3(SPAWN_PELLET_SLOW), ASB3(SPAWN_DONUT_SMALL)},
    {ASB3(RING_BALL),  ASB3(SPAWN_BIG_BALL_FAST),ASB3(SPAWN_BIG_BALL_NORMAL),ASB3(SPAWN_BIG_BALL_SLOW),ASB3(SPAWN_DONUT_MEDIUM)},
    {ASB3(RICE),       ASB3(SPAWN_BIG_BALL_FAST),…, ASB3(SPAWN_DONUT_MEDIUM)},
    {ASB3(BALL),       …},
    {ASB3(KUNAI),      …},
    {ASB3(SHARD),      …},
    {ASB3(BIG_BALL),   ASB3(SPAWN_BIG_BALL_HUGE), ASB3(SPAWN_BIG_BALL_HUGE), ASB3(SPAWN_BIG_BALL_HUGE), ASB3(SPAWN_DONUT_BIG)},
    {ASB3(FIREBALL),   ASB3(SPAWN_BIG_BALL_HUGE), …, ASB3(SPAWN_DONUT_BIG)},
    {ASB3(DAGGER),     ASB3(SPAWN_BIG_BALL_HUGE), …, ASB3(SPAWN_DONUT_BIG)},
    {ASB4(BUBBLE),     ASB4(SPAWN_BUBBLE_SLOW), ASB4(SPAWN_BUBBLE_SLOW), ASB4(SPAWN_BUBBLE_SLOW), ASB4(SPAWN_BUBBLE_NORMAL)},
};
```

### 1.3 模板初始化：ANM 脚本「跑一遍」把默认精灵烤进模板

`src/BulletManager.cpp:1354` `BulletManager::AddedCallback`：

```cpp
if (g_AnmManager->LoadAnm(ANM_FILE_BULLET3, "data/etama3.anm", ANM_OFFSET_BULLET3) != ZUN_SUCCESS) { return ZUN_ERROR; }
if (g_AnmManager->LoadAnm(ANM_FILE_BULLET4, "data/etama4.anm", ANM_OFFSET_BULLET4) != ZUN_SUCCESS) { return ZUN_ERROR; }

for (idx = 0; idx < 10; idx++)
{
    g_AnmManager->SetAndExecuteScriptIdx(&mgr->bulletTypeTemplates[idx].spriteBullet,          g_BulletTypeInfos[idx].bulletAnmScriptIdx);
    g_AnmManager->SetAndExecuteScriptIdx(&mgr->bulletTypeTemplates[idx].spriteSpawnEffectFast,  g_BulletTypeInfos[idx].bulletSpawnEffectFastAnmScriptIdx);
    g_AnmManager->SetAndExecuteScriptIdx(&mgr->bulletTypeTemplates[idx].spriteSpawnEffectNormal,g_BulletTypeInfos[idx].bulletSpawnEffectNormalAnmScriptIdx);
    g_AnmManager->SetAndExecuteScriptIdx(&mgr->bulletTypeTemplates[idx].spriteSpawnEffectSlow,  g_BulletTypeInfos[idx].bulletSpawnEffectSlowAnmScriptIdx);
    g_AnmManager->SetAndExecuteScriptIdx(&mgr->bulletTypeTemplates[idx].spriteSpawnEffectDonut, g_BulletTypeInfos[idx].bulletSpawnEffectDonutAnmScriptIdx);
    mgr->bulletTypeTemplates[idx].spriteBullet.baseSpriteIndex =
        mgr->bulletTypeTemplates[idx].spriteBullet.activeSpriteIndex;
    mgr->bulletTypeTemplates[idx].bulletHeight = mgr->bulletTypeTemplates[idx].spriteBullet.sprite->heightPx;
    /* 之后：按 heightPx 分类设 grazeSize（4/5/6/9/11/16/32）——见 §5.3 */
}
```

机制：每种弹的 ANM 脚本开头有 `SetActiveSprite(精灵基号)`，立刻执行第一帧后把 VM（含 `sprite*` 指针与 `activeSpriteIndex` 基准、颜色、缩放、blend）作为模板存下。真正的子弹生成时**不重放 ANM**，而是整块拷贝模板 VM（见 1.4）。

### 1.4 个体弹：模板拷贝 + `col` 换精灵 + 高度分桶查色

`src/BulletManager.cpp:86` `BulletManager::SpawnSingleBullet`（节选，175–318 行）：

```cpp
bullet->state = BULLET_STATE_FIRED;
bullet->unk_5c2 = 1;
bullet->speed = bulletSpeed;
bullet->angle = utils::AddNormalizeAngle(bulletAngle, 0.0f);
bullet->pos = bulletProps->position;
bullet->pos.z = 0.1f;
sincosmul(&bullet->velocity, bullet->angle, bulletSpeed);
bullet->exFlags = bulletProps->flags;
bullet->spriteOffset = bulletProps->spriteOffset;                       // ← ECL 的 col
bullet->sprites.spriteBullet           = this->bulletTypeTemplates[bulletProps->sprite].spriteBullet;
bullet->sprites.spriteSpawnEffectDonut = this->bulletTypeTemplates[bulletProps->sprite].spriteSpawnEffectDonut;
bullet->sprites.grazeSize              = this->bulletTypeTemplates[bulletProps->sprite].grazeSize;
bullet->sprites.unk_55c                = this->bulletTypeTemplates[bulletProps->sprite].unk_55c;
bullet->sprites.bulletHeight           = this->bulletTypeTemplates[bulletProps->sprite].bulletHeight;
```

`bullet->exFlags & 2/4/8` 分别决定出弹特效用 Fast/Normal/Slow（`bullet->state = BULLET_STATE_SPAWNING_FAST/NORMAL/SLOW`），并对特效 VM 做换色（以 Fast 为例，`BulletManager.cpp:190`）：

```cpp
if (bullet->exFlags & 2)
{
    bullet->sprites.spriteSpawnEffectFast = this->bulletTypeTemplates[bulletProps->sprite].spriteSpawnEffectFast;
    if (bullet->sprites.spriteBullet.sprite->heightPx <= 16.0f)
    {
        g_AnmManager->SetActiveSprite(&bullet->sprites.spriteSpawnEffectFast,
                      bullet->sprites.spriteSpawnEffectFast.activeSpriteIndex + g_BulletSpriteOffset16Px[bulletProps->spriteOffset]);
    }
    else if (bullet->sprites.spriteBullet.sprite->heightPx <= 32.0f)
    {
        if (bullet->sprites.spriteBullet.anmFileIndex != 0x207)   // 0x207 = 火球（脚本号硬编码判等）
        {
            g_AnmManager->SetActiveSprite(&…, … + g_BulletSpriteOffset32Px[bulletProps->spriteOffset]);
        }
        else
        {
            g_AnmManager->SetActiveSprite(&…, bullet->sprites.spriteSpawnEffectFast.activeSpriteIndex + 1);
        }
    }
    else
    {
        g_AnmManager->SetActiveSprite(&…, bullet->sprites.spriteSpawnEffectFast.activeSpriteIndex + bulletProps->spriteOffset);
    }
    bullet->state = BULLET_STATE_SPAWNING_FAST;
}
```

弹体本体的换精灵（无条件执行，`BulletManager.cpp:290`）：

```cpp
g_AnmManager->SetActiveSprite(&bullet->sprites.spriteBullet,
                              bullet->sprites.spriteBullet.activeSpriteIndex + bulletProps->spriteOffset);

if (bullet->sprites.spriteBullet.sprite->heightPx <= 16.0f)
{
    g_AnmManager->SetActiveSprite(&bullet->sprites.spriteSpawnEffectDonut,
                  bullet->sprites.spriteSpawnEffectDonut.activeSpriteIndex + g_BulletSpriteOffset16Px[bulletProps->spriteOffset]);
}
else if (… <= 32.0f) { /* 同上：≠0x207 用 offset32Px[col]；火球固定 +1 */ }
else                 { /* >32：直接 + spriteOffset */ }
```

**语义拆解（spr 与 col）**：

- `spr`（0..9）：选择 10 套模板之一 = 选形状（脚本号 0x200..0x208 / 0x29a）。
- `col`（0..15/0..7/更大）：选择形状内的精灵偏移。etama3 的精灵布局（`AnmIdx.hpp` `ANM_SPRITE_BULLET3_*`）：
  `PELLET=+14, RING_BALL=+30, RICE=+46, BALL=+62, KUNAI=+78, SHARD=+94, BIG_BALL=+110, FIREBALL=+118, DAGGER=+122, SPAWN_DONUT=+130, SPAWN_BALL=+135, SPAWN_BIG_BALL=+140, LASER=+146`；物品（POWER_SMALL=+0…STAR=+6）共用同一张纹理。
- 对 **16px 高**弹（豆/中玉/米粒/大玉/苦无/碎片）：每种形状在纹理里排成「4×4 色板块」，`col` 经 `g_BulletSpriteOffset16Px[16]={0,1,1,1,1,2,2,2,2,3,3,3,4,4,4,0}` 映射到 **行偏移 0..4**（同色不同行？实际是把 16 种 col 折叠到 5 行：0/1/2/3/4）。
- 对 **32px 高**弹（极玉/火球/短剑类）：`g_BulletSpriteOffset32Px[8]={0,1,1,2,2,3,4,0}` 折叠到 8 色。
- 火球（`anmFileIndex==0x207`）是特例：消弹甜甜圈固定用 `activeSpriteIndex+1`（它的「色」由脚本/`vm->color` TFACTOR 驱动，而不是换精灵行）。
- 真正的「颜色」= 纹理块选择（col）× `vm->color`（TFACTOR）二者共同作用：本体淡入用 ANM 脚本 op27 `Fade`，运行时可被 `AnmOpcode_SetColor(24)/SetAlpha(28)/Fade(12)` 改写（`AnmManager::ExecuteScript`，见 §3.2）。

`SetActiveSprite` 本体（`AnmManager.cpp:485`）——把全局精灵槽绑定到 VM 并更新世界/纹理矩阵的缩放分量：

```cpp
ZunResult AnmManager::SetActiveSprite(AnmVm *vm, u32 sprite_index)
{
    if (this->sprites[sprite_index].sourceFileIndex < 0) { return ZUN_ERROR; }
    vm->activeSpriteIndex = (i16)sprite_index;
    vm->sprite = this->sprites + sprite_index;
    D3DXMatrixIdentity(&vm->matrix);
    vm->matrix.m[0][0] = vm->sprite->widthPx / vm->sprite->textureWidth;
    vm->matrix.m[1][1] = vm->sprite->heightPx / vm->sprite->textureHeight;
    return ZUN_SUCCESS;
}
```

ANM 加载时把精灵矩形换算成 UV 并登记进全局槽表（`AnmManager::LoadAnm`→`LoadSprite`，`AnmManager.cpp:390` 附近）：

```cpp
loadedSprite.startPixelInclusive = {rawSprite->offset.x, rawSprite->offset.y};
loadedSprite.endPixelInclusive   = {rawSprite->offset.x + rawSprite->size.x, rawSprite->offset.y + rawSprite->size.y};
loadedSprite.textureWidth = (float)anm->width;  loadedSprite.textureHeight = (float)anm->height;
this->LoadSprite(rawSprite->id + spriteIdxOffset, &loadedSprite);   // ← id + ANM_OFFSET_BULLET3 = 0x200+精灵号
```

即 `ANM_SPRITE_BULLET3_*` 常量 = 「etama3.anm 内部精灵号 + 0x200」。

### 1.5 激光（ECL LASERCREATE / LASERCREATEAIMED）

`EclManager.cpp:460`：填 `EnemyLaserShooter`（width、startTime、duration、despawnDuration、hitbox 等），`type = (opCode==LASERCREATEAIMED ? 0 : 1)`，然后 `BulletManager::SpawnLaserPattern`（`BulletManager.cpp:564`）：

```cpp
g_AnmManager->SetAndExecuteScriptIdx(&laser->vm0, bulletProps->sprite + ANM_SCRIPT_BULLET3_LASER); // 脚本 0x209+弹型
g_AnmManager->SetActiveSprite(&laser->vm0, laser->vm0.activeSpriteIndex + bulletProps->spriteOffset);
g_AnmManager->InitializeAndSetSprite(&laser->vm1, g_BulletSpriteOffset16Px[bulletProps->spriteOffset] + ANM_SPRITE_BULLET3_SPAWN_BIG_BALL); // 根部光球(32px块精灵表)
laser->vm1.flags.blendMode = AnmVmBlendMode_One;
laser->angle = bulletProps->angle;
if (bulletProps->type == 0) { laser->angle += g_Player.AngleToPlayer(&bulletProps->position); }
```

激光本体 VM 每帧被 `ExecuteScript` 驱动，长度/宽度靠改 `scaleX/scaleY` 实现（见 §5.2）。

---

## 2. 弹速 → 初速度向量：`sincosmul` 与 9 种 aimMode

### 2.1 角度约定（ZUN 的 atan2 系）

`src/ZunMath.hpp`（内联汇编，x87 `fsincos`）：

```cpp
void __inline sincosmul(D3DXVECTOR3 *out_vel, f32 input, f32 multiplier)
{
    __asm {
        mov eax, out_vel
        fld input
        fsincos
        fmul [multiplier]
        fstp [eax]      // velocity.x = cos(angle) * multiplier
        fmul [multiplier]
        fstp [eax+4]    // velocity.y = sin(angle) * multiplier
    }
}
```

所以 **velocity = (cos a, sin a)·speed，a=0 指向屏幕右（+x），角度顺时针增大（屏幕 y 向下）**。

`src/Player.cpp`（`AngleToPlayer/AngleFromPlayer`）印证并给出瞄准角：

```cpp
#pragma var_order(relY, relX)
f32 Player::AngleFromPlayer(D3DXVECTOR3 *pos)
{
    f32 relX = pos->x - this->positionCenter.x;
    f32 relY = pos->y - this->positionCenter.y;
    if (relY == 0.0f && relX == 0.0f) { return ZUN_PI / 2; }   // 正下方
    return atan2f(relY, relX);
}

f32 Player::AngleToPlayer(D3DXVECTOR3 *pos)   // 从 pos 指向玩家的角
{
    f32 relX = this->positionCenter.x - pos->x;
    f32 relY = this->positionCenter.y - pos->y;
    if (relY == 0.0f && relX == 0.0f)
    {
        // Shoot down. An angle of 0 means to the right, and the angle goes clockwise.
        return RADIANS(90.0f);
    }
    return atan2f(relY, relX);
}
```

`AddNormalizeAngle`（`utils.cpp`）把角度折回 (−π, π]。

### 2.2 `SpawnSingleBullet` 的 aimMode 全表

`src/BulletManager.cpp:122`：

```cpp
bulletAngle = 0.0f;
bulletSpeed = bulletProps->speed1 - (bulletProps->speed1 - bulletProps->speed2) * bulletIdx2 / bulletProps->count2;
switch (bulletProps->aimMode)
{
case FAN_AIMED:
case FAN:
    if ((bulletProps->count1 & 1) != 0)          // 奇数发：对称展开（…,-2,-1,0,1,2,…）×angle2
    { bulletAngle = ((bulletIdx1 + 1) / 2) * bulletProps->angle2 + bulletAngle; }
    else                                          // 偶数发：半格偏移对称（±0.5, ±1.5, …）×angle2
    { bulletAngle = (bulletIdx1 / 2) * bulletProps->angle2 + bulletProps->angle2 * 0.5f + bulletAngle; }
    if ((bulletIdx1 & 1) != 0) { bulletAngle *= -1.0f; }   // 奇数序号取负 → 扇形对称
    if (bulletProps->aimMode == FAN_AIMED) { bulletAngle += angle; }  // angle=AngleToPlayer(发射点)
    bulletAngle += bulletProps->angle1;                    // 基准角
    break;
case CIRCLE_AIMED:
    bulletAngle += angle;
case CIRCLE:
    bulletAngle += bulletIdx1 * ZUN_2PI / bulletProps->count1;   // 内层：整圈均分
    bulletAngle += bulletIdx2 * bulletProps->angle2 + bulletProps->angle1; // 外层：每圈错 angle2
    break;
case OFFSET_CIRCLE_AIMED:
    bulletAngle += angle;
case OFFSET_CIRCLE:
    bulletAngle += ZUN_PI / bulletProps->count1;                 // 半格错位（与 CIRCLE 交替铺满）
    bulletAngle += bulletIdx1 * ZUN_2PI / bulletProps->count1;
    bulletAngle += bulletProps->angle1;
    break;
case RANDOM_ANGLE:
    bulletAngle = g_Rng.GetRandomF32InRange(bulletProps->angle1 - bulletProps->angle2) + bulletProps->angle2;
    break;
case RANDOM_SPEED:
    bulletSpeed = g_Rng.GetRandomF32InRange(bulletProps->speed1 - bulletProps->speed2) + bulletProps->speed2;
    bulletAngle += bulletIdx1 * ZUN_2PI / bulletProps->count1;
    bulletAngle += bulletIdx2 * bulletProps->angle2 + bulletProps->angle1;
    break;
case RANDOM:
    bulletAngle = g_Rng.GetRandomF32InRange(bulletProps->angle1 - bulletProps->angle2) + bulletProps->angle2;
    bulletSpeed = g_Rng.GetRandomF32InRange(bulletProps->speed1 - bulletProps->speed2) + bulletProps->speed2;
}
```

注意 fallthrough 技巧：`CIRCLE_AIMED` 只比 `CIRCLE` 多一个「+AngleToPlayer」。速度双层插值：`speed1/speed2` 在 `count2` 圈之间线性分布（idx2 越大越接近 speed2）。最终：

```cpp
bullet->angle = utils::AddNormalizeAngle(bulletAngle, 0.0f);
sincosmul(&bullet->velocity, bullet->angle, bulletSpeed);
```

---

## 3. 渲染：blend、colorOp、TFACTOR、zWrite 与两套绘制路径

### 3.1 VM 状态如何变成 D3D8 状态 —— `SetRenderStateForVm`

`src/AnmManager.cpp:522`（完整）：

```cpp
void AnmManager::SetRenderStateForVm(AnmVm *vm)
{
    if (this->currentBlendMode != vm->flags.blendMode)
    {
        this->currentBlendMode = vm->flags.blendMode;
        if (this->currentBlendMode == AnmVmBlendMode_InvSrcAlpha)
            g_Supervisor.d3dDevice->SetRenderState(D3DRS_DESTBLEND, D3DBLEND_INVSRCALPHA);
        else
            g_Supervisor.d3dDevice->SetRenderState(D3DRS_DESTBLEND, D3DBLEND_ONE);
    }
    if ((((g_Supervisor.cfg.opts >> GCOS_USE_D3D_HW_TEXTURE_BLENDING) & 1) == 0) &&
        (((g_Supervisor.cfg.opts >> GCOS_NO_COLOR_COMP) & 1) == 0) && (this->currentColorOp != vm->flags.colorOp))
    {
        this->currentColorOp = vm->flags.colorOp;
        if (this->currentColorOp == AnmVmColorOp_Modulate)
            g_Supervisor.d3dDevice->SetTextureStageState(0, D3DTSS_COLOROP, D3DTOP_MODULATE);
        else
            g_Supervisor.d3dDevice->SetTextureStageState(0, D3DTSS_COLOROP, D3DTOP_ADD);
    }
    if (((g_Supervisor.cfg.opts >> GCOS_DONT_USE_VERTEX_BUF) & 1) == 0)
    {
        if (this->currentTextureFactor != vm->color)
        {
            this->currentTextureFactor = vm->color;
            g_Supervisor.d3dDevice->SetRenderState(D3DRS_TEXTUREFACTOR, this->currentTextureFactor);
        }
    }
    else
    {
        g_PrimitivesToDrawNoVertexBuf[0..3].diffuse = vm->color;   // 顶点色路径（无 TFACTOR）
        g_PrimitivesToDrawUnknown[0..3].diffuse     = vm->color;
    }
    if ((((g_Supervisor.cfg.opts >> GCOS_TURN_OFF_DEPTH_TEST) & 1) == 0) &&
        (this->currentZWriteDisable != vm->flags.zWriteDisable))
    {
        this->currentZWriteDisable = vm->flags.zWriteDisable;
        g_Supervisor.d3dDevice->SetRenderState(D3DRS_ZWRITEENABLE, this->currentZWriteDisable == 0 ? 1 : 0);
    }
}
```

设备初值（`src/GameWindow.cpp` `InitD3dDevice`，全局一次 + 设备丢失后 `Present` 失败时 `Reset+InitD3dDevice` 重建）：

```cpp
g_Supervisor.d3dDevice->SetRenderState(D3DRS_ZENABLE,   GCOS_TURN_OFF_DEPTH_TEST?FALSE:TRUE);
g_Supervisor.d3dDevice->SetRenderState(D3DRS_LIGHTING,  FALSE);
g_Supervisor.d3dDevice->SetRenderState(D3DRS_CULLMODE,  D3DCULL_NONE);
g_Supervisor.d3dDevice->SetRenderState(D3DRS_ALPHABLENDENABLE, TRUE);
g_Supervisor.d3dDevice->SetRenderState(D3DRS_SHADEMODE, …GOURAUD/FLAT…);
g_Supervisor.d3dDevice->SetRenderState(D3DRS_SRCBLEND,  D3DBLEND_SRCALPHA);
g_Supervisor.d3dDevice->SetRenderState(D3DRS_DESTBLEND, D3DBLEND_INVSRCALPHA);
g_Supervisor.d3dDevice->SetRenderState(D3DRS_ZFUNC,     …LESSEQUAL/ALWAYS…);
g_Supervisor.d3dDevice->SetRenderState(D3DRS_ALPHATESTENABLE, TRUE);
g_Supervisor.d3dDevice->SetRenderState(D3DRS_ALPHAREF, 4);
g_Supervisor.d3dDevice->SetRenderState(D3DRS_ALPHAFUNC, D3DCMP_GREATEREQUAL);
g_Supervisor.d3dDevice->SetRenderState(D3DRS_FOGENABLE, …);
g_Supervisor.d3dDevice->SetRenderState(D3DRS_FOGCOLOR, 0xffa0a0a0);
g_Supervisor.d3dDevice->SetRenderState(D3DRS_FOGSTART, 1000.0);
g_Supervisor.d3dDevice->SetRenderState(D3DRS_FOGEND,   5000.0);
SetTextureStageState(0, D3DTSS_COLOROP,  MODULATE 或 SELECTARG1);
SetTextureStageState(0, D3DTSS_COLORARG1, D3DTA_TEXTURE);
SetTextureStageState(0, D3DTSS_COLORARG2, GCOS_DONT_USE_VERTEX_BUF ? D3DTA_DIFFUSE : D3DTA_TFACTOR);
SetTextureStageState(0, D3DTSS_ALPHAOP,  MODULATE 或 SELECTARG1);
SetTextureStageState(0, D3DTSS_ALPHAARG1, D3DTA_TEXTURE);
SetTextureStageState(0, D3DTSS_ALPHAARG2, GCOS_DONT_USE_VERTEX_BUF ? D3DTA_DIFFUSE : D3DTA_TFACTOR);
SetTextureStageState(0, D3DTSS_MIPFILTER, D3DTEXF_NONE);
SetTextureStageState(0, D3DTSS_MAGFILTER/MINFILTER, D3DTEXF_LINEAR);
SetTextureStageState(0, D3DTSS_TEXTURETRANSFORMFLAGS, D3DTTFF_COUNT2);
SetTextureStageState(0, D3DTSS_ADDRESSW, D3DTADDRESS_CLAMP);
SetTextureStageState(0, D3DTSS_ADDRESSU/V, D3DTADDRESS_WRAP);
g_AnmManager->currentBlendMode/currentColorOp/currentVertexShader = 0xff;   // 强制重下发
```

于是弹幕混合的**完整方程**（`vm->color = 0xAARRGGBB`）：

| blendMode（flags bit） | 结果 |
|---|---|
| `AnmVmBlendMode_InvSrcAlpha`（默认） | `dst = src.rgb·A_src + dst·(1−A_src)`；`A_dst = A_tex·A_c` |
| `AnmVmBlendMode_One`（加法） | `dst = src.rgb·A_src + dst`（叠加发光） |

其中 `src.rgb = tex.rgb × TFACTOR.rgb`（COLOROP=MODULATE；ANM op26 可切 ADD：`tex.rgb + TFACTOR.rgb`），`A_src = tex.a × TFACTOR.a`。
**「换色」= 改 TFACTOR（`vm->color`）；「渐隐/闪烁」= 逐帧改 `vm->color` 的 A 分量** —— 这就是 §1 里 `Fade(12)/SetColor(24)/SetAlpha(28)` 的落地处；`GCOS_USE_D3D_HW_TEXTURE_BLENDING`（软件 T&L 老卡）时改用 `g_EffectsColorWithoutTextureBlending` 那组「近白」颜色表，避免无硬件 MODULATE 时颜色丢失。

弹幕本体颜色每帧还会被 `BulletManager::DrawBullet` 强制刷白：`anmVm->color = COLOR_COMBINE_ALPHA(COLOR_WHITE, anmVm->color);`（保留 alpha、RGB 置全白 → 最终色完全由纹理块 + alpha 决定）。

### 3.2 两套顶点路径

硬件顶点处理走 `Draw2/Draw3`（FVF `D3DFVF_TEX1|D3DFVF_XYZ` + 世界矩阵），软件路径走 `Draw/DrawNoRotation/DrawFacingCamera`（FVF `TEX1|XYZRHW`，CPU 投影）。分派逻辑：

```cpp
// AnmManager.cpp:949
ZunResult AnmManager::Draw2(AnmVm *vm)
{
    if (vm->rotation.x != 0 || vm->rotation.y != 0 || vm->rotation.z != 0) { return this->Draw3(vm); }
    …
    worldTransformMatrix = vm->matrix;
    worldTransformMatrix.m[3][0] = rintf(vm->pos.x) - 0.5f;
    worldTransformMatrix.m[3][1] = -rintf(vm->pos.y) + 0.5f;
    if ((vm->flags.anchor & AnmVmAnchor_Left) != 0) { worldTransformMatrix.m[3][0] += (vm->sprite->widthPx * vm->scaleX) / 2.0f; }
    if ((vm->flags.anchor & AnmVmAnchor_Top)  != 0) { worldTransformMatrix.m[3][1] -= (vm->sprite->heightPx * vm->scaleY) / 2.0f; }
    worldTransformMatrix.m[3][2] = vm->pos.z;
    worldTransformMatrix.m[0][0] *= vm->scaleX;
    worldTransformMatrix.m[1][1] *= -vm->scaleY;
    g_Supervisor.d3dDevice->SetTransform(D3DTS_WORLD, &worldTransformMatrix);
    … SetTexture(0, …); SetVertexShader(D3DFVF_TEX1|D3DFVF_XYZ); SetStreamSource(vertexBuffer…);
    this->SetRenderStateForVm(vm);
    g_Supervisor.d3dDevice->DrawPrimitive(D3DPT_TRIANGLESTRIP, 0, 2);   // 或 DrawPrimitiveUP(g_PrimitivesToDrawUnknown)
}
```

`DrawNoRotation`（`AnmManager.cpp:677`，软件路径）：CPU 直接把 quad 摆到设备空间并 ± 半宽高（anchor 处理），z 由 `DrawInner` 写 `vm->pos.z`：

```cpp
fVar2 = (vm->sprite->widthPx * vm->scaleX) / 2.0f;
fVar3 = (vm->sprite->heightPx * vm->scaleY) / 2.0f;
if ((vm->flags.anchor & AnmVmAnchor_Left) == 0)
{
    g_PrimitivesToDrawVertexBuf[0].position.x = … = vm->pos.x - fVar2;
    g_PrimitivesToDrawVertexBuf[1].position.x = … = fVar2 + vm->pos.x;
}
…  // 右对齐：[pos.x, pos.x+2·fVar2]；上/下同理；Draw() 再对 4 个顶点做 TranslateRotation
```

`DrawInner`（655–725）：round 顶点（`__asm frndint; fsub 0.5` 消除半像素抖动）、UV=`uvStart/uvEnd+uvScrollPos`、`SetVertexShader(TEX1|XYZRHW)`、`SetRenderStateForVm`、`DrawPrimitiveUP`。

软件路径的 UV 滚动/旋转细节见 `Draw`（带 rotation.z）：用 `sincos` + `TranslateRotation` 手工旋转四角。

---

## 4. 坐标链：字段坐标 → 屏幕像素（z 项与 1/384 之谜）

### 4.1 视口与相机

`src/GameManager.cpp` `OnUpdate`（每帧）：

```cpp
g_Supervisor.viewport.X      = gameManager->arcadeRegionTopLeftPos.x;   // 32
g_Supervisor.viewport.Y      = gameManager->arcadeRegionTopLeftPos.y;   // 16
g_Supervisor.viewport.Width  = gameManager->arcadeRegionSize.x;         // 384
g_Supervisor.viewport.Height = gameManager->arcadeRegionSize.y;         // 448
g_Supervisor.viewport.MinZ = 0.5;
g_Supervisor.viewport.MaxZ = 1.0;
SetupCamera(0);
g_Supervisor.d3dDevice->SetViewport(&g_Supervisor.viewport);
g_Supervisor.d3dDevice->Clear(0, NULL, D3DCLEAR_ZBUFFER, g_Stage.skyFog.color, 1.0, 0);
```

`GameManager::SetupCamera`（完整）—— 一台**故意造出来的「像素透视相机」**：

```cpp
viewportMiddleWidth  = g_Supervisor.viewport.Width / 2.0f;    // 192
viewportMiddleHeight = g_Supervisor.viewport.Height / 2.0f;   // 224
aspectRatio          = (f32)Width / (f32)Height;              // 384/448
fov                  = D3DXToRadian(30);                      // 30°
cameraDistance       = viewportMiddleHeight / tanf(fov / 2);  // 224/tan15° ≈ 835.86
atVec  = (viewportMiddleWidth + facingDir.x, -viewportMiddleHeight + facingDir.y, 0);
eyeVec = (viewportMiddleWidth, -viewportMiddleHeight, -cameraDistance * facingDir.z);
D3DXMatrixLookAtLH(&g_Supervisor.viewMatrix, &eyeVec, &atVec, &up(0,1,0));
D3DXMatrixPerspectiveFovLH(&g_Supervisor.projectionMatrix, fov, aspectRatio, 100.0f, 10000.0f + extra);
g_Supervisor.d3dDevice->SetTransform(D3DTS_VIEW, …); SetTransform(D3DTS_PROJECTION, …);
```

数学上：视锥在 z=0 平面正好覆盖 `[0,384]×[0,448]`，`tan(15°)·835.86 = 224` ⇒ **世界单位 ≙ 像素，1:1**。「透视」只有把 `pos.z`（激光 0.1、玩家 0.49 等）画出远近效果时用得上，弹体 z≈0 时投影恒等。菜单/关卡背景同理用 `SetupCameraStageBackground(640,480)`（`viewportMiddleWidth=320, half_height=240`，`camera_distance=240/tan15°`，同构）。

### 4.2 弹体坐标：field → backbuffer

- 弹幕逻辑坐标是**场坐标**（0..384 × 0..448，左上原点）。越界判定 `GameManager::IsInBounds(x, y, w, h)` 用 `arcadeRegionSize`（§0 框图，`GameManager.cpp:88`，弹体在 `OnUpdate` 里 `culling` 出界即 `memset` 回收）。
- **硬件 VP**：`BulletManager::DrawBullet → AnmManager::Draw2`，世界矩阵平移 = `(rintf(pos.x)−0.5, −rintf(pos.y)+0.5)`；相机 `at.y=−224, eye.y=−224` 把 −y 拉回屏幕向下，且 x/y 各半像素对齐防缝。
- **软件 VP**：`DrawBulletNoHwVertex` 把场坐标平移到 backbuffer：

```cpp
anmVm->pos.x = g_GameManager.arcadeRegionTopLeftPos.x + bullet->pos.x;   // +32
anmVm->pos.y = g_GameManager.arcadeRegionTopLeftPos.y + bullet->pos.y;   // +16
```

`Draw()` 里再 `rintf` 半像素对齐。两条路径最终都落在 `viewport=(32,16,384,448)` 的视口内，因此**弹幕渲染 = 把「场坐标像素」经 1:1 透视投到「32,16 起点、384×448 视口」**。

### 4.3 `0.0026041667` 是什么

`1/384 = 0.002604166…` —— 视口（=场）宽度的倒数。本次拉取的 AnmManager/BulletManager/GameManager 中**没有**硬编码该字面量（本仓库用 `g_Supervisor.viewport.Width / 2.0f` 表达）。若你在某反汇编里看到它，它是「**场坐标 → 归一化设备坐标 NDC**」的倒数因子：`x_ndc = x_field·(2/384) − 1`（2/384 = 0.005208333，或再 `+X` 偏移折半即 1/384）。换言之它属于「把像素坐标手动换算进 NDC/视口矩形」的那一步，与 §4.1 的 `viewportMiddleWidth` 互为逆运算，不是弹速/精灵尺度。

### 4.4 设备创建参数（640×480 全屏链）

`src/GameWindow.cpp` `InitD3dRendering`：

```cpp
present_params.BackBufferWidth  = GAME_WINDOW_WIDTH;   // 640
present_params.BackBufferHeight = GAME_WINDOW_HEIGHT;  // 480
present_params.EnableAutoDepthStencil = true; AutoDepthStencilFormat = D3DFMT_D16;
present_params.Flags = D3DPRESENTFLAG_LOCKABLE_BACKBUFFER;
// 窗口化/全屏、SwapEffect(FLIP/COPY_VSYNC/COPY)、R5G6B5/X8R8G8B8 探测、
// CreateDevice: 先 D3DCREATE_HARDWARE_VERTEXPROCESSING → 软件 VP HAL → REF，逐级回退
```

`g_Supervisor.hasD3dHardwareVertexProcessing` 即 §3.2 两套路径的开关（HAL-T&L 为 1）。

---

## 5. 行为状态机、擦弹、exFlags 与两处著名 bug

### 5.1 弹体状态机（`BulletManager::OnUpdate`，`BulletManager.cpp:656`）

```
UNUSED ──Spawn──▶ SPAWNING_FAST/NORMAL/SLOW ──▶ FIRED ──▶ DESPAWNING ──▶ UNUSED
   (exFlags&2/4/8)     pos += v / 2.0/2.5/3.0 ×帧率乘子；   Donut 特效 VM 跑完→memset
                        特效脚本 End→goto HELL→FIRED
```

```cpp
case BULLET_STATE_SPAWNING_FAST:
    curBullet->pos += curBullet->velocity / 2.0f * g_Supervisor.effectiveFramerateMultiplier;
    if (g_AnmManager->ExecuteScript(&curBullet->sprites.spriteSpawnEffectFast) == 0) { break; }
    goto HELL;
…
case BULLET_STATE_DESPAWNING:
    curBullet->pos += curBullet->velocity / 2.0f * g_Supervisor.effectiveFramerateMultiplier;
    if (g_AnmManager->ExecuteScript(&curBullet->sprites.spriteSpawnEffectDonut) != 0)
    { memset(curBullet, 0, sizeof(Bullet)); continue; }
```

出弹/消弹阶段弹仍按 1/2、1/2.5、1/3 速度移动（视觉上「弹出/消失」动画）。`isTimeStopped`（暂停/剧情）时整链只 `CHAIN_CALLBACK_RESULT_CONTINUE` 不推进。

### 5.2 激光状态机（同函数下半段）

```cpp
curLaser->endOffset += g_Supervisor.effectiveFramerateMultiplier * curLaser->speed;
if (curLaser->startLength < curLaser->endOffset - curLaser->startOffset)
{ curLaser->startOffset = curLaser->endOffset - curLaser->startLength; }   // 长度裁剪（拖尾）
curLaser->vm0.scaleX = curLaser->width / curLaser->vm0.sprite->widthPx;
curLaser->vm0.scaleY = (endOffset - startOffset) / curLaser->vm0.sprite->heightPx;
curLaser->vm0.rotation.z = ZUN_PI / 2.0f - curLaser->angle;
switch (state) { case 0: // startTime 内：flags&1→按时间淡入 vm0.color=laserColor<<24（A 通道）
                case 1: // duration
                case 2: // despawnDuration：flags&1→淡出；否则 width -= width/despawn·t
                        // hitboxEndDelay 内仍投 hitbox
```

激光「淡入淡出」直接写 `vm0.color` 的 alpha（`laserColor << 24`），加粗/缩尾直接改 `vm0.scaleX`。根部光球 vm1 在 `startOffset<16` 时补画，`flags.colorOp = AnmVmColorOp_Add` + `blendMode=One`。

### 5.3 绘制顺序 = 按精灵高度分桶（同层不透明/加法混合正确叠序）

`BulletManager::OnDraw`（`BulletManager.cpp:1111`）：先 `ZFUNC=ALWAYS`（弹永远画在最前且不写深度冲突），激光→物品→弹，弹按 `bulletHeight` 分 4 轮，**16px 中 RING_BALL/BALL 单独再拆一轮**（大玉叠在普通 16px 弹之下）：

```cpp
g_Supervisor.d3dDevice->SetRenderState(D3DRS_ZFUNC, D3DCMP_ALWAYS);
… Draw3(laser…) / g_ItemManager.OnDraw();
if (g_Supervisor.hasD3dHardwareVertexProcessing) { 4× for: bulletHeight>16 / ==16(RING|BALL) / ==16(其余) / ==8 → DrawBullet(); }
else { 同构 DrawBulletNoHwVertex(); }
g_Supervisor.d3dDevice->SetRenderState(D3DRS_ZFUNC, D3DCMP_LESSEQUAL);
```

`DrawBullet` 选择当前 state 对应 VM（SPAWNING_*→对应特效 VM，DESPAWNING→Donut，FIRED→本体），仅当 `anmVm->autoRotate != 0`（ANM op32 `SetAutoRotate`）时：

```cpp
anmVm->rotation.z = (ZUN_PI / 2.0f) - bullet->angle;   // DrawBullet / DrawBulletNoHwVertex 均有
```

纹理里的弹体精灵按「屏幕正下」方向绘制；由 §2.1 的旋转公式推导，`rot.z = π/2 − a` 恰好把「朝下」转到速度方向 `(cos a, sin a)`，即弹头始终指向飞行方向（米粒/苦无/短剑的朝向就靠 ANM 脚本的 op32 + 这一行）。

### 5.4 擦弹 / 判定

`OnUpdate` 中每弹每帧（`BulletManager.cpp:921` 起）：

```cpp
if (curBullet->isGrazed == 0)
{
    grazeState = g_Player.CheckGraze(&curBullet->pos, &curBullet->sprites.grazeSize);
    if (grazeState == 1) { curBullet->isGrazed = 1; goto bulletGrazed; }
    else if (grazeState == 2) { curBullet->state = BULLET_STATE_DESPAWNING; g_ItemManager.SpawnItem(&curBullet->pos, ITEM_POINT_BULLET, 1); }
}
else if (curBullet->isGrazed == 1)
{
    grazeState = g_Player.CalcKillBoxCollision(&curBullet->pos, &curBullet->sprites.grazeSize);
    if (grazeState != 0) { curBullet->state = BULLET_STATE_DESPAWNING; if (grazeState == 2) { SpawnItem; } }
}
```

- 首次 `CheckGraze`：`hitboxSize=(1.25,1.25)`，擦弹盒 = 弹的 `grazeSize` 盒 + **20px** 外扩（`CheckGraze` 里 `±size/2±20` 的常量），命中 → `ScoreGraze`（+500 分、graze++、音效、粒子）。
- `isGrazed` 一旦置 1 就转用 `CalcKillBoxCollision`（只查死亡盒；Bomb 弹幕盒命中返回 2=转物品）。`grazeSize` 在模板初始化里按高度/弹型定档（8→4、≤16→4/5/6、≤32→9/11/16、其他→32）。

### 5.5 exFlags 全语义（`SpawnSingleBullet` 尾部 + `OnUpdate`）

| bit | 含义 | OnUpdate 行为（verbatim 摘要） |
|---|---|---|
| 0x01 | 初速冲刺 | 前 16 帧 `v = (angle, speed + (5 − t·5/16))`，到 16 帧清位 |
| 0x02/0x04/0x08 | 出弹特效 Fast/Normal/Slow | 进入 SPAWNING_* 并换对应 VM+色 |
| 0x10 | 加速度 | `velocity += ex4Acceleration ×mult; angle = atan2f(vy, vx)`（到 `ex5Int0` 帧清除） |
| 0x20 | 角速度+线性变速 | `angle += ex5Float1×mult; speed += ex5Float0×mult; sincosmul(...)`（注释：*Has to be done in asm. Just, great.*） |
| 0x40 | 分段转向（增量） | 每 `dirChangeInterval` 帧 `angle += dirChangeRotation; speed = dirChangeSpeed`；段内速度从 0 插值到满（弹「逐段折线」） |
| 0x100 | 分段转向（绝对角） | `angle = dirChangeRotation`（如「先斜飞再垂直落下」） |
| 0x80 | 分段转向（追踪玩家） | `angle = AngleToPlayer + dirChangeRotation`（灵乌路空/紫式部式折线弹） |
| 0x1c0 任一 | `dirChangeMaxTimes` 用完后 `exFlags &= ~bit` | 同上 |
| 0x200 | 发声 | `flags & 0x200 → PlaySoundByIdx(bulletProps->sfx)`（`SpawnBulletPattern` 尾部） |
| 0x800/0x400 | 由 `SpawnSingleBullet` 在 0x1c0 之外另读 exFloats 设定 | 0x400/0x800 分支：`dirChangeSpeed=exFloats[0]…`（见源码 `& 0xc00` 组合） |

### 5.6 擦除/转物品/奖励分

```cpp
void BulletManager::RemoveAllBullets(ZunBool turnIntoItem)   // Bomb 调用：全部 DESPAWNING（或转物品+memset）
i32  BulletManager::DespawnBullets(maxBonusScore, awardPoints) // Boss 死亡奖励：每弹 2000+10·n 封顶，
    // 弹→DESPAWNING、激光→state2、SpawnItem(ITEM_POINT_BULLET)、CreatePopup1、score 累加
// 已知 bug ①（Laser，OnUpdate case 0/2，代码注释原文）：
// "Bug: ZUN intended to set laserSize.y instead of laserSize.x … hitbox would be thinner"
// 即 startTime/despawn 阶段激光 hitbox 宽度用了错误的轴 → 实际 hitbox 比视觉细
// 已知 bug ②（本文件多处 "Has to be done in asm"）：0x20 的 angle 更新顺序依赖编译器行为
//   与 BulletData 无关——纯浮点/汇编对齐产物，reccmp 只能手拼
```

---

## 6. 附录 A：AnmManager 关键 opcode → VM 字段（`AnmManager::ExecuteScript`）

弹/物品/激光共用的 VM 解释器（`AnmManager.cpp:1057` 起，节选 verbatim 结构）：

```cpp
case AnmOpcode_ExitHide/Exit:  vm->flags.isVisible = 0; vm->currentInstruction = NULL; return 1;
case AnmOpcode_SetActiveSprite:
    vm->flags.isVisible = 1;
    this->SetActiveSprite(vm, curInstr->args[0] + this->spriteIndices[vm->anmFileIndex]);
    vm->timeOfLastSpriteSet = vm->currentTimeInScript.AsFrames();   // ← 脚本精灵 = 参数 + 文件精灵表基址
case AnmOpcode_SetRandomSprite:
    this->SetActiveSprite(vm, local_c[0] + g_Rng.GetRandomU16InRange(local_c[1]) + this->spriteIndices[vm->anmFileIndex]);
case AnmOpcode_SetScale/SetAlpha/SetColor/Jump/FlipX/FlipY/UsePosOffset/
     SetRotation/SetAngleVel/SetScaleSpeed/ScaleTime/Fade/
     SetBlendAdditive(vm->flags.blendMode=One)/SetBlendDefault(InvSrcAlpha)/SetVisibility/
     AnchorTopLeft/SetAutoRotate(vm->autoRotate=args[0])/UVScrollX/UVScrollY(wrap 到 [0,1))/
     SetZWriteDisable(vm->flags.zWriteDisable=args[0])/Nop/InterruptLabel/Stop/StopHide…
```

脚本结束后（`stop:` 段）逐帧推进插值器：`angleVel` 积分旋转；`scaleInterp`（op21 ScaleTime：三次缓动 `1−(1−t)³` 等）；`alphaInterp`（op27 Fade：按分量线性插到 `alphaInterpFinal`，0–255 钳位）；`posInterp`（op25 系 PosTime）。弹幕的「出生缩放、淡入、出弹弹性」全部由 etama3/4.anm 脚本驱动。

## 附录 B：与本次抓取互相印证的关键数值

| 事实 | 出处 |
|---|---|
| 场 384×448，偏移 (32,16)；移动盒 8..372 × 16..432 | `GameManager::AddedCallback` verbatim |
| fov=30°, dist=224/tan15°, near100/far10000 | `SetupCamera` verbatim |
| velocity=(cos a, sin a)·speed | `ZunMath.hpp::sincosmul` |
| 16px 弹 16 色 / 32px 弹 8 色 / 火球特例 | `g_BulletSpriteOffset16Px/32Px` + `anmFileIndex!=0x207` |
| 模板 5 VM/弹型 × 10 | `BulletTypeInfo[10]` |
| ANM 脚本号 = 0x200+spr、0x29a+spr4 | `AnmIdx.hpp` |
| blend 切换只动 DESTBLEND、颜色=TFACTOR 调制 | `SetRenderStateForVm` |
| ZFUNC ALWAYS 弹层 | `OnDraw` |
| 擦弹 +20px | `Player::CheckGraze` |

## 附录 C：本次抓取未覆盖（如需我可以继续）

- `EnemyEclInstr.cpp` 中 `GetVar` 的 `default:` 字面回退分支、`GetVarFloat` 全文；
- `EnemyManager.cpp` 的 `DEATHBLAST`（boss 死亡散弹）组装 `EnemyBulletShooter` 的细节（`BulletManager::DespawnBullets` 已见）；
- `ItemManager.cpp` 物品 VM 初始化（`ANM_SCRIPT_BULLET3_ITEMS_START+col` 路径在 Item 侧）；
- `Supervisor.cpp` 主循环/状态机全文；`Stage.cpp` 背景相机 `SetupCameraStageBackground(640,480)` 初值；
- `BulletData.cpp`（自机弹 `g_CharacterPowerDataReimuA/B、MarisaA/B` 表：弹道/伤害/间隔，§引用已提及但表体未展开）。
