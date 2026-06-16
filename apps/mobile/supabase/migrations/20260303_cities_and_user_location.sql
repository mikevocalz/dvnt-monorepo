-- ============================================================
-- Cities table + user location preferences for Near Me
-- ============================================================

-- Cities lookup table with coordinates for weather + event proximity
CREATE TABLE IF NOT EXISTS cities (
  id          SERIAL PRIMARY KEY,
  name        TEXT NOT NULL,
  state       TEXT,            -- US state abbreviation or region
  country     TEXT NOT NULL DEFAULT 'US',
  lat         DOUBLE PRECISION NOT NULL,
  lng         DOUBLE PRECISION NOT NULL,
  timezone    TEXT,            -- e.g. 'America/New_York'
  population  INTEGER,         -- for sorting/relevance
  slug        TEXT UNIQUE NOT NULL,  -- url-safe e.g. 'new-york-ny'
  created_at  TIMESTAMPTZ DEFAULT now()
);

-- Seed top US cities
INSERT INTO cities (name, state, country, lat, lng, timezone, population, slug) VALUES
  ('New York',      'NY', 'US', 40.7128, -74.0060, 'America/New_York',     8336817, 'new-york-ny'),
  ('Los Angeles',   'CA', 'US', 34.0522, -118.2437, 'America/Los_Angeles', 3979576, 'los-angeles-ca'),
  ('Chicago',       'IL', 'US', 41.8781, -87.6298, 'America/Chicago',      2693976, 'chicago-il'),
  ('Houston',       'TX', 'US', 29.7604, -95.3698, 'America/Chicago',      2320268, 'houston-tx'),
  ('Phoenix',       'AZ', 'US', 33.4484, -112.0740, 'America/Phoenix',     1680992, 'phoenix-az'),
  ('Philadelphia',  'PA', 'US', 39.9526, -75.1652, 'America/New_York',     1603797, 'philadelphia-pa'),
  ('San Antonio',   'TX', 'US', 29.4241, -98.4936, 'America/Chicago',      1547253, 'san-antonio-tx'),
  ('San Diego',     'CA', 'US', 32.7157, -117.1611, 'America/Los_Angeles', 1423851, 'san-diego-ca'),
  ('Dallas',        'TX', 'US', 32.7767, -96.7970, 'America/Chicago',      1343573, 'dallas-tx'),
  ('Austin',        'TX', 'US', 30.2672, -97.7431, 'America/Chicago',      978908,  'austin-tx'),
  ('Miami',         'FL', 'US', 25.7617, -80.1918, 'America/New_York',     467963,  'miami-fl'),
  ('Atlanta',       'GA', 'US', 33.7490, -84.3880, 'America/New_York',     498715,  'atlanta-ga'),
  ('San Francisco', 'CA', 'US', 37.7749, -122.4194, 'America/Los_Angeles', 873965,  'san-francisco-ca'),
  ('Seattle',       'WA', 'US', 47.6062, -122.3321, 'America/Los_Angeles', 737015,  'seattle-wa'),
  ('Denver',        'CO', 'US', 39.7392, -104.9903, 'America/Denver',      715522,  'denver-co'),
  ('Washington',    'DC', 'US', 38.9072, -77.0369, 'America/New_York',     689545,  'washington-dc'),
  ('Nashville',     'TN', 'US', 36.1627, -86.7816, 'America/Chicago',      689447,  'nashville-tn'),
  ('Portland',      'OR', 'US', 45.5152, -122.6784, 'America/Los_Angeles', 652503,  'portland-or'),
  ('Las Vegas',     'NV', 'US', 36.1699, -115.1398, 'America/Los_Angeles', 641903,  'las-vegas-nv'),
  ('Detroit',       'MI', 'US', 42.3314, -83.0458, 'America/Detroit',      639111,  'detroit-mi'),
  ('Minneapolis',   'MN', 'US', 44.9778, -93.2650, 'America/Chicago',      429954,  'minneapolis-mn'),
  ('New Orleans',   'LA', 'US', 29.9511, -90.0715, 'America/Chicago',      383997,  'new-orleans-la'),
  ('Charlotte',     'NC', 'US', 35.2271, -80.8431, 'America/New_York',     874579,  'charlotte-nc'),
  ('Tampa',         'FL', 'US', 27.9506, -82.4572, 'America/New_York',     384959,  'tampa-fl'),
  ('Brooklyn',      'NY', 'US', 40.6782, -73.9442, 'America/New_York',     2736074, 'brooklyn-ny')
ON CONFLICT (slug) DO NOTHING;

-- Add location columns to users table
ALTER TABLE users ADD COLUMN IF NOT EXISTS city_id INTEGER REFERENCES cities(id);
ALTER TABLE users ADD COLUMN IF NOT EXISTS location_mode TEXT DEFAULT 'city' CHECK (location_mode IN ('city', 'device', 'hidden'));
ALTER TABLE users ADD COLUMN IF NOT EXISTS device_lat DOUBLE PRECISION;
ALTER TABLE users ADD COLUMN IF NOT EXISTS device_lng DOUBLE PRECISION;
ALTER TABLE users ADD COLUMN IF NOT EXISTS location_updated_at TIMESTAMPTZ;

-- Add city_id to events for location-based filtering
ALTER TABLE events ADD COLUMN IF NOT EXISTS city_id INTEGER REFERENCES cities(id);

-- Index for fast city lookups
CREATE INDEX IF NOT EXISTS idx_cities_slug ON cities(slug);
CREATE INDEX IF NOT EXISTS idx_cities_country ON cities(country);
CREATE INDEX IF NOT EXISTS idx_users_city_id ON users(city_id);
CREATE INDEX IF NOT EXISTS idx_events_city_id ON events(city_id);

-- RLS policies for cities (public read, no direct write from client)
ALTER TABLE cities ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Cities are publicly readable" ON cities FOR SELECT USING (true);

-- Grant access
GRANT SELECT ON cities TO anon, authenticated;
GRANT ALL ON cities TO service_role;
GRANT USAGE, SELECT ON SEQUENCE cities_id_seq TO service_role;

-- Deferred FK from event_spotlight_campaigns.city_id → cities(id)
-- (20260302 created the column but cities didn't exist yet, so FK was skipped)
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.tables
    WHERE table_schema = 'public' AND table_name = 'event_spotlight_campaigns'
  ) THEN
    IF NOT EXISTS (
      SELECT 1 FROM information_schema.table_constraints
      WHERE constraint_name = 'fk_spotlight_city'
        AND table_name = 'event_spotlight_campaigns'
    ) THEN
      ALTER TABLE event_spotlight_campaigns
        ADD CONSTRAINT fk_spotlight_city
        FOREIGN KEY (city_id) REFERENCES cities(id) ON DELETE SET NULL;
    END IF;
  END IF;
END $$;
