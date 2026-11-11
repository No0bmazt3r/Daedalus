-- The device id names the physical rig, not the SCADA app (009 used the app's
-- name). Relabel both earlier ids.
UPDATE chat_sessions SET device_id = 'mini-co2-rig-01'
 WHERE device_id IN ('CO2SorptionDT', 'co2_reactor');
