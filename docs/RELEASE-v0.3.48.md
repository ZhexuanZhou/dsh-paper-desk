# v0.3.48

- 修复点击 AI 抽屉左侧拖动条时面板瞬间回缩、松开又恢复的问题
- 拖动期间不再切换受控 width，宽度只通过 DOM/ref 更新，松手才提交 React state
- 实测点击前后抽屉宽度 360px 不变；拖动到 450px 稳定

安装：`dsh plugin --profile web add @zhe_xuan/dsh-paper-desk`
