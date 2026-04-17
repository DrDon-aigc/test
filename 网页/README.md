# 网页

这是可部署到 Netlify 的独立目录。

## 部署前

在 Netlify 项目里添加环境变量：

- `RUNNINGHUB_API_KEY`

## 目录结构

- `site/`: 前端页面
- `netlify/functions/`: 服务端函数
- `netlify.toml`: Netlify 配置

## 重要说明

不要把真实的 `RUNNINGHUB_API_KEY` 写进前端代码或提交到公开仓库。

如果只做静态拖拽发布，静态页面可以上线，但要让服务端函数正常工作，推荐使用 Netlify 的项目导入或 CLI 部署流程。
