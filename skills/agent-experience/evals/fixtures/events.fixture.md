# fixture events（评测数据集；七列格式同 .skill-evolution/events.md L2，只读不写）
# 样本设计：#0000=≥14 天 promoted 无 outcome（欠账卡正样本）；#0001=旧但有 outcome_verified（欠账排除）；
# #0002=<14 天 promoted 无 outcome（欠账排除）；#0003=canary promoted(agent)+使用注记（canary 卡正样本）；
# #0004=仅 proposed（无 promoted → 不产卡）
20260920-090000 | 20260920-090000-01 | agent-experience | #0000-debt-owes | promoted | human | .skill-evolution/candidates/#0000-debt-owes/REVIEW.md
20260918-090000 | 20260918-090000-01 | agent-experience | #0001-old-verified | promoted | human | .skill-evolution/candidates/#0001-old-verified/REVIEW.md
20260919-090000 | 20260919-090000-01 | agent-experience | #0001-old-verified | outcome_verified | human | reviews/outcome-0001.md
20261008-090000 | 20261008-090000-01 | agent-experience | #0002-fresh-skill | promoted | human | .skill-evolution/candidates/#0002-fresh-skill/REVIEW.md
20261009-090000 | 20261009-090000-01 | agent-experience | #0003-canary-pilot | promoted | agent | .skill-evolution/candidates/#0003-canary-pilot/REVIEW.md  # canary
20261009-120000 | 20261009-120000-01 | agent-experience | #0003-canary-pilot | evidence_note | agent | ses_evalcards  # canary 使用：cards eval dry-run 显式点名一次
20260921-090000 | 20260921-090000-01 | agent-experience | #0004-never-promoted | proposed | agent | /tmp/na.md
