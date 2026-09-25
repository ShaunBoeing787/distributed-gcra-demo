-- One atomic GCRA admission transition. KEYS[1] is the shared TAT cell.
-- ARGV[1] = emission interval in ms; ARGV[2] = allowed burst delay in ms.
local emission = tonumber(ARGV[1])
local burstDelay = tonumber(ARGV[2])
local t = redis.call('TIME')
local now = t[1] * 1000 + math.floor(t[2] / 1000)
local tat = tonumber(redis.call('GET', KEYS[1]) or '0')
local anchored = math.max(tat, now)

if anchored - now > burstDelay then
  return {0, anchored - burstDelay - now}
end

local nextTat = anchored + emission
redis.call('SET', KEYS[1], nextTat)
redis.call('PEXPIREAT', KEYS[1], nextTat)
return {1, 0}
