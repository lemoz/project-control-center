# Two-repo architecture diagram

```
+----------------------------------------------------------+
| project-control-center (OSS core)                        |
| - Next.js UI (PWA)                                       |
| - Local API + runner                                     |
| - SQLite state + Work Orders                             |
| - Chat, tech tree, portfolio                             |
+----------------------------+-----------------------------+
                             |
                             | optional cloud calls
                             v
+----------------------------------------------------------+
| pcc-cloud (proprietary services)                         |
| - Auth and billing                                       |
| - VM provisioning and monitoring                         |
| - Hosted observability and alerts                        |
| - Marketing site                                         |
+----------------------------------------------------------+

Self-hosted mode runs only the core box on your machine.
Cloud mode connects the core to managed services in pcc-cloud.
```
