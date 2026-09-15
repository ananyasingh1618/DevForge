// Fixture file for DevForge's evaluation dataset (Phase 13). Small, synthetic,
// non-sensitive sample code written for this dataset — not copied from any
// real project. Exercises the "exact API route" retrieval category, and is a
// deliberately CORRECT counterpart to api/projectsController.ts's
// deliberately-vulnerable getProject, so review evaluation has a clean
// authorization example alongside the vulnerable one.

import { findOrdersByUserId } from "../db/orderRepository.js";

type Req = { params: { id: string }; user: { id: string } };
type Order = { id: string; userId: string };
declare function loadOrderById(id: string): Promise<Order | null>;

/**
 * Route: GET /api/orders/:id
 * Loads a single order by id and verifies the requester owns it before
 * returning it — the correct pattern, unlike projectsController.ts's
 * getProject.
 */
export async function getOrderRoute(req: Req): Promise<Order> {
  // Route: GET /api/orders/:id
  const order = await loadOrderById(req.params.id);
  if (!order) {
    throw new Error("Order not found");
  }
  if (order.userId !== req.user.id) {
    throw new Error("Forbidden");
  }
  return order;
}

/**
 * Route: GET /api/orders
 * Lists the authenticated user's own orders.
 */
export async function listMyOrdersRoute(req: Req): Promise<Order[]> {
  return findOrdersByUserId(req.user.id) as unknown as Promise<Order[]>;
}
