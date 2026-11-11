-- The device is the rig's own SCADA app, CO2SorptionDT. Sessions created under
-- the old placeholder id are relabelled. The column DEFAULT in 001 still says
-- 'co2_reactor', but every insert passes device_id explicitly, so it never applies.
UPDATE chat_sessions SET device_id = 'CO2SorptionDT' WHERE device_id = 'co2_reactor';
