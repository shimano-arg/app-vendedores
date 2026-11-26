# monitoring/alerts/

Templates de Cloud Monitoring alert policies para `app-vendedores-shimano`.

Estos YAMLs **NO estan aplicados**. Son templates listos para `gcloud alpha monitoring policies create --policy-from-file=...` una vez que Mariano:

1. Decida canal de notificacion (email vs Slack vs PagerDuty). Default: email a `erbinomariano@gmail.com`.
2. Cree el notification channel en Cloud Console (o via `gcloud alpha monitoring channels create`).
3. Reemplace `NOTIFICATION_CHANNEL_ID_PLACEHOLDER` por el ID real del channel.
4. Aplique con `gcloud` autenticado contra `app-vendedores-shimano`.

## Archivos

| Archivo | Metrica | Umbral | Ventana |
|---|---|---|---|
| `commit-pedido-error-rate.yaml` | `commitPedidoCF` error rate | > 5% | 5 min |
| `critical-cfs-error-rate.yaml` | `getUsersDirectoryCF`, `getTotpStatusCF`, `releaseAsigCF`, `applyRepartoManualCF` | > 2% | 5 min |
| `commit-pedido-latency-p95.yaml` | `commitPedidoCF` p95 latency | > 10s | 5 min |
| `operations-log-writes-anomaly.yaml` | writes/sec contra baseline 1-10/min | > 50/min o < 0.5/min por 10 min | 10 min |

## Comando de habilitacion (dry-run por defecto)

```bash
# Dry-run: validar YAML
gcloud alpha monitoring policies create \
  --policy-from-file=monitoring/alerts/commit-pedido-error-rate.yaml \
  --project=app-vendedores-shimano \
  --dry-run

# Aplicar (requiere auth + decision humana de canal)
gcloud alpha monitoring policies create \
  --policy-from-file=monitoring/alerts/commit-pedido-error-rate.yaml \
  --project=app-vendedores-shimano
```

## Permisos requeridos

El principal que ejecute necesita:
- `roles/monitoring.alertPolicyEditor`
- `roles/monitoring.notificationChannelEditor` (para crear channels)

## Ver tambien

- Documento maestro: `../STACK_40_D5_ALERTAS.md` (en Desktop\RESPUESTAS\).
- Fallback sin GCP Monitoring: `.github/workflows/monitor-post-deploy.yml` (opcional).
