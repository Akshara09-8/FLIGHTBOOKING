-- Demo seed data (example values only). Run after 0001_init.sql.
-- Dates are around Diwali 2027 (29 Oct 2027) and Chhath 2027.

insert into public.festivals (id, name, start_date, end_date, region) values
  ('11111111-0000-0000-0000-000000000001', 'Diwali 2027',      '2027-10-27', '2027-11-01', 'All India'),
  ('11111111-0000-0000-0000-000000000002', 'Chhath Puja 2027', '2027-11-03', '2027-11-07', 'Bihar, Jharkhand, East UP'),
  ('11111111-0000-0000-0000-000000000003', 'Christmas 2027',   '2027-12-22', '2027-12-27', 'Kerala, Goa, North East');

insert into public.flights (id, airline, flight_no, origin, destination, departs_at, arrives_at) values
  ('22222222-0000-0000-0000-000000000001', 'Demo Air', 'DA 401', 'DEL', 'PAT', '2027-10-29 18:40+05:30', '2027-10-29 20:25+05:30'),
  ('22222222-0000-0000-0000-000000000002', 'Demo Air', 'DA 512', 'BOM', 'LKO', '2027-10-28 07:15+05:30', '2027-10-28 09:20+05:30'),
  ('22222222-0000-0000-0000-000000000003', 'Demo Air', 'DA 233', 'BLR', 'COK', '2027-12-23 13:05+05:30', '2027-12-23 14:15+05:30'),
  ('22222222-0000-0000-0000-000000000004', 'Demo Air', 'DA 402', 'PAT', 'DEL', '2027-11-07 09:30+05:30', '2027-11-07 11:20+05:30');

insert into public.pools
  (festival_id, flight_id, origin, destination, travel_date, time_window, min_seats, max_seats,
   seats_filled, cut_off_at, status, market_fare_paise, target_fare_paise)
values
  ('11111111-0000-0000-0000-000000000001', '22222222-0000-0000-0000-000000000001', 'DEL', 'PAT', '2027-10-29', 'evening',   30, 40, 32, '2027-10-08 23:59+05:30', 'min_reached', 1480000, 945000),
  ('11111111-0000-0000-0000-000000000001', '22222222-0000-0000-0000-000000000002', 'BOM', 'LKO', '2027-10-28', 'morning',   30, 40, 18, '2027-10-07 23:59+05:30', 'open',        1230000, 820000),
  ('11111111-0000-0000-0000-000000000003', '22222222-0000-0000-0000-000000000003', 'BLR', 'COK', '2027-12-23', 'afternoon', 30, 40,  9, '2027-12-02 23:59+05:30', 'open',         980000, 610000),
  ('11111111-0000-0000-0000-000000000002', '22222222-0000-0000-0000-000000000004', 'PAT', 'DEL', '2027-11-07', 'morning',   30, 40, 22, '2027-10-17 23:59+05:30', 'open',        1350000, 890000);

-- To make yourself admin after signing up once, run (replace the email):
-- update public.profiles set role = 'admin' where email = 'you@example.com';
