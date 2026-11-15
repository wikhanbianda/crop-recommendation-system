#!/bin/sh
# Pemakaian: tests/db/setup.sh <socket_dir> <port> <dbname>   (menjalankan skema pada DB kosong)
set -e
H=$1; P=$2; D=$3; R=$(cd "$(dirname "$0")/../.." && pwd)
PSQL="psql -h $H -p $P -U postgres -v ON_ERROR_STOP=1 -q"
psql -h $H -p $P -U postgres -q -c "drop database if exists $D" -c "create database $D"
for f in tests/db/emulate_supabase.sql database/schema.sql database/triggers.sql database/policies.sql database/seed.sql; do
  $PSQL -d $D -f "$R/$f" >/dev/null
done
echo "skema terpasang di $D"
