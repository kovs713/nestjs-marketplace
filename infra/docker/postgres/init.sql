-- init create role / database
CREATE ROLE catalog LOGIN PASSWORD 'catalog';

CREATE ROLE inventory LOGIN PASSWORD 'inventory';

CREATE ROLE orders LOGIN PASSWORD 'orders';

CREATE ROLE payments LOGIN PASSWORD 'payments';

CREATE ROLE users LOGIN PASSWORD 'users';

CREATE ROLE notification LOGIN PASSWORD 'notification';

CREATE DATABASE catalog OWNER catalog;

CREATE DATABASE inventory OWNER inventory;

CREATE DATABASE orders OWNER orders;

CREATE DATABASE payments OWNER payments;

CREATE DATABASE users OWNER users;

CREATE DATABASE notification OWNER notification;

-- postgres role only for migrations / debugs from psql
-- not allowed for services
REVOKE ALL ON DATABASE catalog FROM public;

REVOKE ALL ON DATABASE inventory FROM public;

REVOKE ALL ON DATABASE orders FROM public;

REVOKE ALL ON DATABASE payments FROM public;

REVOKE ALL ON DATABASE users FROM public;

REVOKE ALL ON DATABASE notification FROM public;

-- grants
GRANT ALL ON DATABASE catalog TO catalog;

GRANT ALL ON DATABASE inventory TO inventory;

GRANT ALL ON DATABASE orders TO orders;

GRANT ALL ON DATABASE payments TO payments;

GRANT ALL ON DATABASE users TO users;

GRANT ALL ON DATABASE notification TO notification;

