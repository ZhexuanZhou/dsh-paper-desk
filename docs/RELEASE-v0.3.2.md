# PaperDesk v0.3.2

中文输入法下「按 Enter 不发送」的修复。

## 问题

在 AI 助读输入框用中文输入法打字时，第一次按 Enter 会被输入法用来**选词/确认候选**，
不会触发发送；用户看到输入框没变化，容易以为坏了。部分 Chromium/输入法组合下还会出
现 `isComposing` 状态残留，导致之后按 Enter 也不发送。

## 修复

- 用 `compositionstart` / `compositionend` 明确跟踪输入法状态，不再只依赖
  `event.nativeEvent.isComposing`（部分组合会残留）。
- 选词过程中：Enter 只用于选词，并在输入框下方显示提示
  「输入法选词中：按 Enter 完成选词，再按一次 Enter 发送」。
- 选词结束后：Enter 正常发送；点击「发送」按钮同样不受影响。
- 发送失败时保留输入内容并提示错误（0.3.1 已有）。

## 安装

```sh
dsh plugin --profile web add @zhe_xuan/dsh-paper-desk
```

或使用本 Release 的预构建包。

## 验证

- 模拟输入法 composition：选词中按 Enter 不发送且显示提示；composition 结束后按 Enter 正常发送
- 普通 Enter 发送、Shift+Enter 换行不变
- `tsc` / 构建通过
