<!-- BEGIN:nextjs-agent-rules -->
# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` before writing any code. Heed deprecation notices.
<!-- END:nextjs-agent-rules -->

# AI Chat + Image Studio 项目入门

这是一个类 ChatGPT 的 AI 对话与图片创作项目。当前第一版已经包含聊天、图片生成/编辑、会话历史、搜索、上传文件、本地输出存储、Prisma/MySQL 数据层，以及 OpenAI-compatible 服务端代理。

## 快速运行

项目根目录是 `E:\JIMMY\AI-Proj\AI-CHAT\Main`。

常用命令：

```powershell
pnpm install
pnpm prisma:generate
pnpm prisma:migrate
pnpm prisma:seed
pnpm dev
```

开发地址：

```text
http://127.0.0.1:3000/ai/chat
```

验证命令：

```powershell
pnpm typecheck
pnpm lint
pnpm build
```

注意：`pnpm build` 当前可能出现一个 Turbopack NFT tracing warning，来源是服务端运行时读写 `data/uploads` 和 `data/outputs`。构建会成功，这个警告不影响当前开发运行。

## 环境变量

真实密钥建议放在 `.env.local`。可以参考 `.env.local.example`：

```env
DATABASE_URL="mysql://root:xxx@localhost:3306/xxx"
OPENAI_BASE_URL="https://api.openai.com/v1"
OPENAI_API_KEY="sk-your-api-key"
OPENAI_CHAT_MODEL="gpt-5.5"
OPENAI_IMAGE_MODEL="gpt-image-2"
```

项目使用 Prisma 7 的 MariaDB adapter 连接 MySQL。对外仍使用 `mysql://...`，运行时会在 `src/server/db-url.ts` 自动转换成 adapter 需要的 `mariadb://...`。

如果 `OPENAI_API_KEY` 为空：
- 聊天接口会返回一段本地 mock 流式回复。
- 图片接口会生成本地 SVG 占位图。
- 这样可以先验证 UI、数据库和文件流转。

## 主要路由

前端页面：

- `/`：重定向到 `/ai/chat`。
- `/ai/chat`：新聊天首页，随机欢迎语，中间输入框。
- `/ai/chat/[id]`：聊天详情页，展示历史消息、图片输入、流式回复。
- `/ai/image`：新建图片创作页。
- `/ai/image/[id]`：图片创作详情页，支持基于选中图片继续迭代。

API routes：

- `POST /api/conversations`：创建聊天或图片会话。
- `GET /api/conversations?type=&cursor=&limit=10`：左侧最近历史分页。
- `GET /api/conversations/[id]`：获取会话详情。
- `PATCH /api/conversations/[id]`：重命名会话。
- `DELETE /api/conversations/[id]`：软删除会话。
- `GET /api/search?q=&type=`：搜索弹窗，支持全部/聊天/图片筛选。
- `POST /api/assets/upload`：上传聊天图片或图片参考图。
- `GET /api/assets/[id]`：读取本地上传/输出文件。
- `POST /api/chat/[id]/messages`：保存用户消息并代理 `/v1/responses` 流式回复。
- `POST /api/image/[id]/turns`：创建图片生成/编辑轮次，按是否有参考图分流到 generations 或 edits。

## 目录地图

核心目录：

```text
src/app/                 Next.js App Router 页面和 API routes
src/components/          前端组件
src/components/ui/       shadcn/Radix 风格基础组件
src/lib/                 前后端共享配置、schema、类型和工具函数
src/server/              只在服务端使用的 DB、OpenAI、文件存储、序列化逻辑
prisma/                  Prisma schema、migration、seed
data/uploads/            用户上传图片
data/outputs/            AI 生成图片输出
```

推荐阅读顺序：

1. `src/lib/config.ts`：聊天和图片参数的静态配置入口。
2. `prisma/schema.prisma`：业务数据模型。
3. `src/app/api/conversations/route.ts`：会话创建和历史分页。
4. `src/app/api/chat/[id]/messages/route.ts`：聊天消息保存和流式回复。
5. `src/app/api/image/[id]/turns/route.ts`：图片生成/编辑主流程。
6. `src/components/app-shell/app-shell.tsx`：全局侧栏和最近历史。
7. `src/components/chat/chat-detail.tsx`：聊天详情页交互。
8. `src/components/image-studio/image-studio.tsx`：图片工作台。

## 数据模型理解

`Conversation` 是核心会话表，统一承载聊天和图片创作：

- `type=CHAT`：对应 `/ai/chat/[id]`。
- `type=IMAGE`：对应 `/ai/image/[id]`。
- `lastMessageAt`：用于左侧最近历史排序。
- `deletedAt`：软删除。
- `activeAssetId`：图片会话当前选中/最新作品。

聊天相关：

- `ChatMessage` 保存用户和 AI 消息。
- `attachments` 保存聊天图片附件快照。
- `providerResponseId` 和 `previousResponseId` 用于兼容 OpenAI Responses 的 response 链。
- 当前实现是混合模式：本地保存全量消息，同时保存 provider response id。

图片相关：

- `ImageTurn` 保存每一轮图片生成/修改。
- `params` 保存当轮图片参数。
- `referenceAssetIds` 保存参考图。
- `outputAssetIds` 保存生成结果。
- `baseAssetId` / `activeAssetId` 用于基于上一张图继续修改。

文件相关：

- `Asset` 统一保存上传图、参考图、输出图、mask 预留。
- 文件落盘在 `data/uploads` 或 `data/outputs`。
- 前端统一通过 `/api/assets/[id]` 访问文件，不直接暴露真实文件路径。

日志相关：

- `ApiUsageLog` 记录 API 类型、模型、端点、耗时、状态码、request id 和错误信息。

## 聊天流程

新聊天：

1. 用户在 `/ai/chat` 输入文字或上传图片。
2. 前端调用 `POST /api/conversations` 创建 `CHAT` 会话。
3. 草稿暂存到 `sessionStorage`。
4. 跳转 `/ai/chat/[id]`。
5. 详情页读取草稿并调用 `POST /api/chat/[id]/messages`。

聊天详情：

1. API 保存用户消息。
2. API 创建 assistant 占位消息。
3. 如果配置了 OpenAI key，组装本地历史消息调用 `/v1/responses`。
4. 后端把 OpenAI 原始 stream 转成项目自己的 SSE：`meta`、`delta`、`done`、`error`。
5. 前端逐字追加 `delta`。
6. 完成后刷新会话详情和左侧历史。

## 图片流程

新建图片：

1. 用户在 `/ai/image` 输入 prompt，可上传最多 4 张参考图。
2. 点击生成后先创建 `IMAGE` 会话。
3. 草稿暂存到 `sessionStorage`。
4. 跳转 `/ai/image/[id]` 后开始生成。

图片详情：

1. 没有参考图/基础图时，调用 `/v1/images/generations`。
2. 有参考图、上一轮选中图或 active image 时，调用 `/v1/images/edits`。
3. API 返回的 base64 图片写入 `data/outputs`。
4. `ImageTurn.outputAssetIds` 记录结果，`Conversation.activeAssetId` 指向当前图。
5. 用户可在结果缩略图里选择 active image，下一轮会基于它继续修改。

## UI 结构

全局布局在 `src/app/ai/layout.tsx`，使用 `AppShell` 包住 AI 相关页面。

`AppShell` 包含：

- 顶部品牌文字 `ChatGPT Plus`。
- 左侧按钮：新聊天、搜索聊天、创作图片。
- 最近历史：聊天和图片混排，按 `lastMessageAt` 倒序。
- 历史项菜单：重命名、删除。
- 搜索弹窗：全部/聊天/图片类型筛选。

聊天 UI：

- `ChatHome`：空状态首页。
- `ChatDetail`：详情页状态和 SSE 消费。
- `ChatComposer`：输入框、图片上传、高级推理选项。
- `MessageList`：消息展示和工具按钮。

图片 UI：

- `ImageStudio`：同时服务 `/ai/image` 和 `/ai/image/[id]`。
- 左侧：prompt、参考图上传、生成按钮。
- 中间：主画布、loading、输出缩略图。
- 右侧：比例、模型、质量、数量、格式、压缩、审核参数。

## 参数配置入口

主要看 `src/lib/config.ts`：

- `chatConfig`：聊天模型、图片输入开关、图片数量限制、推理选项。
- `imageConfig`：图片模型、参考图数量、允许文件类型、默认参数、可见参数。

图片右侧面板是否展示某个参数由 `imageConfig.visibleParams` 控制。隐藏字段不会强行进入 UI；请求构造也会尽量只发送可见/必要字段，避免因为预留参数导致接口报错。

## OpenAI-compatible 接口层

服务端 OpenAI 相关逻辑在 `src/server/openai.ts`：

- `postResponsesStream`：调用 `/v1/responses`。
- `postImageGeneration`：调用 `/v1/images/generations`。
- `postImageEdit`：调用 `/v1/images/edits`。
- `extractImageResults`：从图片接口结果里提取 `b64_json`。

所有 OpenAI 调用都在服务端完成，浏览器端不会拿到 API key。

## 开发约定

- 使用 `pnpm`。
- 文件编辑后至少跑 `pnpm typecheck` 和 `pnpm lint`。
- 涉及路由、构建、Next 页面约定时跑 `pnpm build`。
- 修改 Prisma schema 后运行：

```powershell
pnpm prisma:generate
pnpm prisma:migrate
```

- 如果要初始化默认用户：

```powershell
pnpm prisma:seed
```

- 不要手动编辑 `src/generated/prisma`，它是生成代码。
- 不要把真实 `.env.local`、上传文件、输出图片提交到仓库。
- 当前项目还没有完整登录，只有默认本地用户；数据表已经预留 `User` 和 `userId`。

## 常见问题

### 为什么 Prisma 用 MySQL 但又装了 MariaDB adapter？

Prisma schema 的 provider 是 `mysql`，数据库也是 MySQL。Prisma 7 的新客户端需要 driver adapter；这里使用 `@prisma/adapter-mariadb` 连接 MySQL/MariaDB 协议。项目会把 `mysql://...` 自动转换为 adapter 需要的 `mariadb://...`。

### 为什么没有 API key 也能聊天和生成图？

为了便于本地验收 UI，后端做了 mock fallback。配置 `OPENAI_API_KEY` 后会切换到真实第三方 API。

### 图片为什么通过 `/api/assets/[id]` 访问？

这样可以把真实文件路径留在服务端，并为后续权限校验、多用户隔离、CDN 或对象存储迁移留下空间。

### 新增功能应该从哪里开始？

- 新页面：先看 `src/app/ai/*`。
- 新 API：先看 `src/app/api/*`，请求校验放 `src/lib/schemas.ts`。
- 新数据库字段：先改 `prisma/schema.prisma`，再生成 migration。
- 新 UI 控件：优先复用 `src/components/ui/*`。
- 新 OpenAI 参数：优先改 `src/lib/config.ts` 和 `src/server/openai.ts`。
