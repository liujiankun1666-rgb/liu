# 任务、回传、验收与审批协议

代码中的权威类型定义为 [`shared/hotel.ts`](../../shared/hotel.ts)。以下 JSON 均为脱敏例子，不包含真实经营数字、账号和客资；示例 ID 需由实际创建接口的返回值替换。

## 一、任务创建与分派

任务创建与派单分开。创建返回 `draft`，加入队列后才可能派发。服务端检查门店、岗位绑定、前置任务、截止时间、次数上限、并发及执行权限。

```json
{
  "propertyId": "xingcheng-aigong",
  "title": "核对本店共享知识中的房型说明",
  "objective": "检查已提供的房型资料是否存在配置冲突，输出可核对的缺失项。",
  "role": "supervisor",
  "action": "analysis",
  "priority": "normal",
  "inputs": "仅使用本任务引用的已核实酒店资料；不访问生产后台。",
  "acceptanceCriteria": [
    "逐项列出所用来源和版本",
    "没有核实的配置明确标为待确认",
    "给出需要老板补充的具体资料"
  ],
  "dependencies": [],
  "knowledgeIds": [],
  "idempotencyKey": "example-room-description-review-v1",
  "maxAttempts": 3
}
```

`knowledgeIds` 应填入知识创建接口返回的同店 ID。任务可设置 `parentTaskId`、依赖 `dependencies` 和 ISO 时间 `deadline`。不允许跨店依赖、跨店知识引用或循环依赖。重用同一幂等键但改变任务内容会被拒绝，应使用新请求键。

派单说明默认包含当前门店 `property`（酒店资料）、`rooms`（房型）、`policy`（制度）和 `metrics`（指标口径）四类知识的最新版本，以及任务显式引用的其他知识。每项附知识 ID、标题和包含来源的版本记录；空的 `knowledgeIds` 不会排除这四类基础知识。知识在派单时取当前版本，不会凭空补齐现场尚未录入的资料。具体选择逻辑见 [`gateway-payload.ts`](../../electron/services/hotel/gateway-payload.ts)。

### 实际调用路径

Renderer 调用 `src/lib/hotel-api.ts`，经现有 Host API 进入 Main 进程。页面不能直连 OpenClaw Gateway。

派发时 Main 先保存执行记录，再发送：

```json
{
  "method": "chat.send",
  "params": {
    "sessionKey": "agent:existing-agent-id:hotel:example-task-id:example-attempt-id",
    "message": "由 Main 生成的任务说明、同店知识、依赖结果与回传格式",
    "deliver": false,
    "idempotencyKey": "hotel:example-task-id:example-attempt-id"
  }
}
```

这使用现有 Agent 的独立任务会话。`deliver: false` 不允许向原通信渠道投递回复，但**不限制工具的写权限**；权限预检是另一道程序检查。

## 二、Agent 回传

Agent 最后输出单个 JSON 对象，或只包裹这个对象的 JSON 代码块。不在其前后加入解释文字。`taskId` 与 `attemptId` 必须精确匹配当前任务及执行批次。

### 完成回传

```json
{
  "taskId": "example-task-id",
  "attemptId": "example-attempt-id",
  "outcome": "completed",
  "result": {
    "summary": "已完成给定样例资料的一致性核对。此处为协议示例，不代表现场核对已经发生。",
    "completedItems": ["核对资料标题、版本和配置字段"],
    "missingItems": [],
    "sources": [
      {
        "label": "脱敏样例资料",
        "uri": "example://hotel-room-data/v1",
        "observedAt": "2026-11-27T09:00:00+08:00"
      }
    ],
    "artifacts": [],
    "dataPeriod": "仅针对已给定的样例版本，不代表实时经营数据",
    "verificationNotes": "说明实际核对方法与未覆盖范围。",
    "suggestedNextActions": ["用真实且已授权的资料完成现场验收"]
  }
}
```

正式结果至少包含一项来源或产物证据，且 `completedItems` 非空。来源字段包括标签、URI 和采集时间。程序检查格式与必要证据，**不保证 URI 内容真实**；老板或独立总管验收还需核对来源与结论。

`completed` 只表示 Agent 提交完毕。任务随后进入 `needs_review`，不是 `succeeded`。有 `missingItems` 的结果可展示和退回，但不能验收通过。

`missingItems` 表示当前任务的验收标准尚未满足。只有不妨碍当前验收标准的数据局限才写入 `verificationNotes` 和 `summary`，后续核查建议写入 `suggestedNextActions`。例如任务只要求核对一份合成快照的计算与口径，无法推断真实经营原因属于适用范围说明；如果任务要求查明原因，缺少原因证据就是验收缺项。不能通过改字段名称隐藏未完成的要求。

### 回传来源与历史留存

服务器记录当前结果的 `resultOrigin`：`gateway` 为关联 Agent 执行会话，`owner` 为老板手工录入，`bridge` 为桥接客户端。该字段由调用路径决定，不能用结果正文自行声明来源。

| 字段 | 保留内容 |
| --- | --- |
| `task.resultHistory` | 每次有效回传的执行批次、归档时间、来源和完整结果，以及后续老板或独立总管的验收决定、意见与主体 |
| `task.planHistory` | 修改前的方案版本、目标、岗位、动作、输入、验收条件、依赖、知识引用、具体经营计划及当时的审批记录 |

编辑、退回优化或展开讨论方案会保留旧依据；重跑不覆盖原有回传历史。任务详情中的“历史方案与回传”和同店导出均可追溯这些记录。当前版本失效的旧结果和旧批准仍保留在历史中，但不能据此把新版本标为通过。单任务方案归档达到 500 条时拒绝继续变更，要求建立后续任务，不静默删除旧记录。实现见 [`domain.ts`](../../electron/services/hotel/domain.ts)。

### 总管讨论后动态分派

普通总管讨论任务可以在 `result` 中额外返回 `plannedTasks`。这是可审核的工作方案，还没有创建下属任务。例如：

```json
{
  "plannedTasks": [
    {
      "title": "核对指定经营日的 PMS 汇总",
      "objective": "依据已授权汇总报表核对房量与房费口径。",
      "role": "pms",
      "action": "read",
      "inputs": "采用任务提供的统计日期；缺资料则明确回传缺失。",
      "acceptanceCriteria": ["来源与统计周期明确", "不修改生产数据"],
      "dependsOn": []
    },
    {
      "title": "复核经营指标计算口径",
      "objective": "根据第一项已验收结果复核指标计算条件。",
      "role": "finance",
      "action": "analysis",
      "inputs": "仅用已验收的前置数据，不读取无关财务资料。",
      "acceptanceCriteria": ["列出公式和分母", "不把缺失数据填成零"],
      "dependsOn": [0]
    }
  ]
}
```

最多 16 项，`dependsOn` 引用同数组的 0 基索引，必须无循环。只接受 `read`、`analysis`、`code`；`code` 只能分配给 `codex` 岗位。模型不能指定别的门店或用这个结构加入付款、调价等动作。

老板在工作台预览并点击“确认方案并派给现有 Agent”后，Main 在一个事务内创建全部子任务及依赖，子任务进入队列，原总管任务等待它们验收后再汇总。重复点击返回原有任务组。原讨论结果保存在 `task.delegation.result`，不会因后续汇总而失去依据；同一讨论不会无限重复拆单。

### 独立总管验收

普通业务 Agent 回传后，如果本店启用了一个**不同 Agent ID** 的总管，系统可创建独立验收任务。服务端固定 `reviewTarget` 的原任务、执行批次、结果摘要与验收 Agent。总管回传仍需完整 `HotelTaskResult`，并增加：

```json
{
  "assessment": {
    "decision": "return",
    "note": "所给来源缺少统计结束时间，不能确认与原任务经营日一致，请补充。"
  }
}
```

只有服务端创建的验收任务可以包含 `assessment`；普通任务不能通过附加该字段自行验收。禁止自审、跨店验收、验收旧结果以及验收另一个验收任务。`accept` 还要求原结果没有缺项且全部依赖已通过。通过的质量验收写明 `actor:"supervisor"` 和关联验收任务；总管自己的结果仍由老板验收。经营变更审批始终是独立的老板动作。

验收任务的 `result.missingItems` 描述**本次审查是否完整**，不重复存放目标任务的缺项。两类缺项按以下规则处理：

| 实际情况 | 合法回传 | 对目标的处理 |
| --- | --- | --- |
| 审查已完成，目标缺项或未满足验收标准 | `completed`，`assessment.decision:"return"`；在 `assessment.note` 列出目标缺项、依据与返修要求，审查自身 `missingItems:[]` | 退回原执行岗，保留旧结果及验收历史 |
| 审查自身缺少必要证据或读取能力，无法形成完整结论 | `blocked`，`error` 说明审查阻塞及所需证据 | 不替目标作通过决定 |
| 审查完整，固定目标无缺项、全部标准有证据满足，依赖和子任务已验收 | `completed`，`assessment.decision:"accept"`，审查自身 `missingItems:[]` | 服务端校验后才通过 |

服务端同时拒绝审查自身不完整的 `accept` / `return`，以及目标仍有缺项的 `accept`。目标已登记的缺项即使被怀疑只是适用范围说明，也应先 `return`，由原执行岗核实、解释并按原流程提交新版本；不清空旧结果、不修改固定验收对象、不降低验收条件。

带 `reviewTarget` 的验收结果只接受关联 Gateway 执行回传。MCP 的 `hotel_submit_result` 同时拒绝所有 `role:"supervisor"` 任务和所有带 `reviewTarget` 的任务；共享桥接令牌不能代替总管回传讨论或验收结果。老板手动验收应调用独立的 `review` 动作，不能向验收任务录入一份伪装成 Gateway 的结果。

### 阻塞或失败回传

```json
{
  "taskId": "example-task-id",
  "attemptId": "example-attempt-id",
  "outcome": "blocked",
  "error": "当前没有可核验的已授权报表，无法计算入住率。需要提供指定经营日的汇总数据。"
}
```

`failed` 使用同样字段，写明执行错误。登录失效、缺少资料、权限不足、格式错误和网络故障应具体描述，不用“已完成”掩盖。

### 指标字段

需要经营日报时，可在 `result.metrics` 提交 `availableRooms`、`occupiedRooms`、`roomRevenue`、`orders`、`refunds`、`costs`。每项必须包含：

| 字段 | 含义 |
| --- | --- |
| `key` | 指标类型；同一结果中不能重复 |
| `value` | 有限且非负的数字；房数/订单数必须为整数 |
| `periodStart` / `periodEnd` | 实际统计区间的开始和结束，采用 ISO 时间；结束为不包含端点 |
| `basis` | 可比较的业务口径，需真实且一致 |
| `source` | `label`、`uri`、`observedAt` |

日报只使用已经验收、属于当前门店和经营日的数据。入住率、ADR、RevPAR 只有在参与计算的区间及口径一致时才计算；缺数据返回 `null`。同一天不同回传值存在冲突时提示核对，展示最近验收的数据，不静默相加。

“经营日对比”逐项比较可售房、已入住房、客房收入、订单、退款和成本。两个报告须属于同一门店和时区、日期不同；两期都有已验收指标、`basis` 一致，并按门店时区覆盖已结束且日界线相同的完整经营日，才计算“本期减基期”及相对变化。缺项、部分经营日、尚未结束或口径不一致时显示不可比原因；基期为 0 时保留差值，比例为 `null`。检查逻辑见 [`report-comparison.ts`](../../src/pages/Hotel/report-comparison.ts)。

这些差值用于观察，不等于某次调价、内容投放或服务调整造成了变化。策略复盘仍需核对节假日、活动、房量、渠道和其他同时发生的变化；当前不提供自动因果归因。

## 三、抖音制作结果

`result.content` 的字段如下，所有制作字段都需要填写真实方案：

| 字段 | 要求 |
| --- | --- |
| `topic` | `hotel`、`games`、`hardware`、`service` 之一 |
| `title` / `hook` | 标题和开场钩子；同店规范化标题去重 |
| `script` / `storyboard` / `subtitles` | 脚本、分镜和字幕 |
| `coverPlan` / `caption` | 封面方案和发布文案 |
| `durationSeconds` / `aspectRatio` | 30–60 秒；固定 `9:16` |
| `scores` | 至少两项 `{criterion, score, maximum, reason}`，各项满分合计 100 |
| `improvements` | 改进建议；低于 80 分时不得为空 |
| `templateId` / `inputRevision` | 可选的模板来源和输入版本 |

Agent 不能填写 `publication`。只有方案已验收且分数不低于 80 时，老板才可另行提供 HTTPS 链接登记**已经人工发布**的视频。本系统不会因为登记动作而向抖音上传或发布；总管质量验收也不等于允许对外发布。

修改输入、退回优化或形成新任务后，不能把旧结果和旧审批当成新版本已通过。重复标题校验不等于全面语义去重，相似题意仍需复核。

### 同店历史、主题轮换与模板复用

抖音任务派单时附带 `contentContext`：最多 60 条同店非取消内容任务的现有结果摘要，以及按 `hotel → games → hardware → service` 循环的下一主题建议。顺序以最近执行结束时间（没有时采用任务创建时间）确定，之后登记人工发布不会把旧内容重新算作最新选题。主题建议仍需在生成与验收时落实。

自动提供的 `acceptedQualityTemplates` 最多 3 项，均为同店已验收且达到 80 分的完整内容与来源。另可参考最多 10 条同店经验知识的最新版本；经验内容和来源仍需核实。质量评分不能证明播放、转化或营收表现，没有真实效果数据时应明确缺失。实现见 [`content-context.ts`](../../electron/services/hotel/content-context.ts)。

页面的“复用已验收内容”可把当前门店已验收的抖音结果作为结构参考，创建独立的 `draft` 并打开编辑。它复制制作字段作为输入，保留来源任务标识和知识引用；不复制旧评分、验收结论、批准或发布记录。新任务须补充新选题与当前事实，重新生成、评分和验收。这个草稿入口不以 80 分筛选源内容，80 分仍是新结果登记人工发布的门槛；自动质量参考模板则按上述 80 分条件筛选。实现见 [`content-reuse.ts`](../../src/pages/Hotel/content-reuse.ts)。

## 四、任务状态

| 状态 | 进入条件 | 后续动作 |
| --- | --- | --- |
| `draft` 草稿 | 新建或退回/修改 | 修改、加入队列 |
| `queued` 待执行 | 分析/查询/隔离代码任务已提交 | 等待依赖、派发、取消 |
| `running` 执行中 | 执行记录已持久化并派发 | 回传、核对会话、取消 |
| `needs_review` 待验收 | 收到本次执行的有效结果 | 老板或独立总管通过/退回；讨论方案可由老板确认派单 |
| `succeeded` 已验收 | 老板或独立总管通过且无缺失项/未完成依赖 | 保留验收主体与依据；抖音可在达标后由老板登记人工发布 |
| `awaiting_approval` 待审批 | 敏感动作有具体计划 | 老板批准或拒绝 |
| `failed` 失败 | 本次执行有明确失败 | 修改、在次数上限内重试、创建技术工单 |
| `blocked` 已阻塞 | 接入条件不足、执行不确定或生产适配器不可用 | 排障、核对、修改或按规则重试 |
| `cancelled` 已取消 | 老板取消任务 | 保留记录，不继续调度 |

最大执行次数默认 3、最多 5。超时或重启后，原任务可能仍在 Gateway 运行；先读原会话核对，再决定是否重试。确认不确定执行后再重试是显式动作，不能通过编辑或重新入队悄悄绕过。

## 五、经营计划审批

敏感动作类型为 `price_change`、`publish`、`payment`、`refund`、`message`、`config_change`。对应任务需要实际可审阅的 `plan`：

```json
{
  "target": "明确门店、平台、房型、日期或其他影响对象",
  "before": "经核实的当前状态",
  "after": "拟执行的具体状态",
  "reason": "变更依据与预期影响",
  "rollback": "何时、由谁、用什么方式回退或补救"
}
```

老板审批请求：

```json
{
  "decision": "approve",
  "planVersion": 1,
  "note": "已核对本次展示的对象、变化和回退条件。"
}
```

服务端保存实际计划摘要、版本、时间与决定。新版本使旧审批失效。桥接接口没有批准或验收工具。当前生产执行适配器未接入，批准只保存决定，任务保持明确阻塞，不会自动改价、付款、退款或发送消息。

## 六、接口索引

所有 `/api/hotel/*` 由本地桌面 Host API 认证保护；不应直接暴露到公网。

| 接口 | 用途 |
| --- | --- |
| `GET /api/hotel/snapshot` | 门店、岗位、任务、知识、计划、能力及模板 |
| `GET /api/hotel/report?propertyId=…&date=YYYY-MM-DD` | 指定经营日日报 |
| `GET /api/hotel/execution-policy?agentId=…&action=analysis` | 实际工具配置预检；也接受 `read`、`code` |
| `POST /api/hotel/tasks` / `PUT /api/hotel/tasks/:id` | 创建与修改任务 |
| `POST /api/hotel/tasks/:id/queue` / `dispatch` | 入队与请求派发 |
| `POST /api/hotel/tasks/:id/reconcile` / `retry` / `cancel` | 核对、重试、取消 |
| `POST /api/hotel/tasks/:id/result` | `{attemptId,result}` 结构化回传 |
| `POST /api/hotel/tasks/:id/review` / `approve` | 本地老板验收/审批 |
| `POST /api/hotel/tasks/:id/delegate` | 老板确认总管返回的子任务方案并原子展开 |
| `POST /api/hotel/tasks/:id/technical` | 建立关联技术工单 |
| `POST /api/hotel/tasks/:id/record-publication` | `{url}` 登记人工发布 |
| `POST /api/hotel/workflows` | `{propertyId,kind,idempotencyKey}`；`daily_operations`、`pricing_review`、`content_review` |
| `POST /api/hotel/run-ready` | 检查当前门店就绪任务 |
| `PUT /api/hotel/bindings` | 绑定既有 Agent |
| `POST /api/hotel/knowledge` / `schedules` / `properties` | 知识、计划、门店管理 |
| `GET /api/hotel/export?propertyId=…` | 导出同店记录 |
| `GET` / `POST` / `DELETE /api/hotel/bridge` | 桥接状态、轮换授权、撤销 |

MCP 暴露的是另一组受限工具，详见[接入文档](integration.md)，不与老板 Host API 令牌混用。

## 原生技术执行身份

HotelAttempt新增可选executor（gateway或codex-cli，旧记录省略时仍为Gateway）。原生sessionKey以codex-cli开头，runId关联真实CLI thread与当前attempt；resultOrigin增加codex-cli。native attempt只接受同执行器实际回执，不能由bridge/owner/Gateway覆盖。审批与独立验收权限不变，技术结果默认needs_review。桥接入队审计actor明确为bridge；旧历史事件不倒改。详细限制见[native-codex.md](native-codex.md)。
