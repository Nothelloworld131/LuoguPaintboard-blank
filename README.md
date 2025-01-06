# 锣鼓冬日绘板.空白计划.脚本

## 项目简介

锣鼓冬日绘板是一款用于绘制白色矩形的在线工具。通过该工具，用户可以设置多个 UID 和 Token 来自动绘制指定区域内的白色矩形。项目使用 WebSocket 进行实时通信，并提供了热力图和日志记录功能。

## 如何使用

### 环境准备

1. **安装 VSCode**：
   - 访问 [VSCode 官方网站](https://code.visualstudio.com/) 并下载安装最新版本。
   
2. **安装 Live Server 插件**：
   - 打开 VSCode，点击左侧活动栏中的扩展图标（四个方块组成的图标），搜索 "Live Server" 并安装。

### 项目设置

1. **创建项目文件夹**：
   - 在本地磁盘上创建一个新的文件夹，例如 `winterhuiban`，并将项目文件放入其中。

2. **打开项目文件夹**：
   - 使用 VSCode 打开刚刚创建的文件夹。

3. **启动 Live Server**：
   - 在 VSCode 中右键点击 `index.html` 文件，选择 "Open with Live Server"。

### 配置参数

- **获取 Token**：
  - 在页面中填写 UID 和 Paste 地址，点击 "获取 Token" 按钮。
  
- **配置参数**：
  - 输入 uid:token 列表、uid:paste 列表、矩形参数等配置信息。
  
- **操作控制**：
  - 点击 "开始" 按钮启动绘图任务，点击 "暂停" 按钮停止任务。

## 依赖项

- **HTML5**
- **CSS3**
- **JavaScript (ES6+)**
- **Bootstrap 4.5.2**
- **html2canvas**

## 贡献指南

欢迎任何开发者为项目贡献代码或提出改进建议。请遵循以下步骤：

1. 叉子 (Fork) 本仓库到你的 GitHub 账户。
2. 克隆 (Clone) 仓库到本地。
3. 创建一个新的分支 (`git checkout -b feature/your-feature-name`)。
4. 提交你的更改 (`git commit -m 'Add some feature'`)。
5. 推送到你的分支 (`git push origin feature/your-feature-name`)。
6. 发起拉取请求 (Pull Request)。

## 许可证

没有。

## 参考链接

- [嘟嘟噜](https://www.luogu.com/paste/arts59f8)

我们使用了 AI 修缮了 README。
