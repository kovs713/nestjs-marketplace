# **Main Tasks:**

1. Initialize a Nest.js monorepo from scratch.

2. Design and implement a microservice architecture:
  - API Gateway/Auth;
  - Catalog;
  - Inventory;
  - Order;
  - Notification; 
  with strictly isolated databases.

3. Integrate Kafka for business event streaming
(Saga pattern, cross-service data sync) and RabbitMQ
for asynchronous task queues (notifications,
background jobs).

4. Implement WebSocket connections in the
Notification Service to push real-time updates 
to clients.

5. Containerize all services and infrastructure
components using Docker and configure their
deployment in Kubernetes.

## **System Architecture**

1. **Client** – The requester interacting with the
backend. Connects via HTTP (REST) and WebSocket.

2. **API Gateway (Auth/Users)** – The single entry point for HTTP. Handles routing, authentication, and user profiles. Connected to its own PostgreSQL database.

3. **Catalog Service** – Read-heavy service. Manages product listings, categories, and prices. Connected to its own PostgreSQL database and uses Redis for caching. Consumes stock events from Kafka to maintain eventual consistency.

4. **Inventory Service** – Write-heavy service. Manages physical stock counters (`total`, `reserved`). Connected to its own PostgreSQL database. Publishes stock change events to Kafka.

5. **Order Service** – Orchestrator. Manages the cart (as draft orders), checkout process, and order lifecycle. Connected to its own PostgreSQL database. Publishes business events to Kafka and notification tasks to RabbitMQ.

6. **Notification Service** – Holds and manages active WebSocket connections. Consumes tasks from RabbitMQ and pushes real-time updates to the appropriate clients.

7. **Kafka** – Event log for core business state changes and asynchronous data synchronization between services.

8. **RabbitMQ** – Task queue for decoupling background jobs and delivering notifications.


## **Actors**

User (Buyer), User (Seller).

## **Expected System Behavior**

1. The **Seller** creates a product in the Catalog
and specifies the initial stock quantity in the
Inventory.

2. The **Buyer** adds items to the cart and
initiates checkout. The Order Service creates a
draft order, requests a reservation from the
Inventory Service, and sets the order status to
"Pending Payment".

3. The system simulates payment processing.

4. Upon successful payment, the order status changes to "Paid", and the Inventory deducts the reserved stock. Upon failed payment or timeout, the order is canceled, and the Inventory releases the reservation.

5. The Inventory Service publishes a stock update event to Kafka. The Catalog Service consumes it to update its local cache. Clients subscribed via WebSocket to the product receive the updated stock quantity in real-time.

6. The Order Service publishes a notification task to RabbitMQ. The Notification Service consumes it and pushes the updated order status to the Buyer via WebSocket.

## **Tech Stack Requirements**

- Nest.js monorepo (created from scratch).
- PostgreSQL. Strict rule: each service operates only on its own isolated database. Cross-service JOIN queries are prohibited.
- Drizzle ORM for schema definition, migrations, and query execution.
- Kafka for event-driven business communication and data sync.
- RabbitMQ for asynchronous task dispatching and notifications.
- WebSocket (e.g., Socket.io) implemented directly in the Notification Service for real-time client updates.
- Redis for Catalog caching and optional WebSocket adapter/pub-sub.
- Kubernetes for deploying all microservices, databases, and message brokers.
