/**
 * Event Promotion / Spotlight Types
 */

export type CampaignPlacement = "spotlight" | "feed" | "spotlight+feed";
export type CampaignStatus =
  | "pending"
  | "active"
  | "paused"
  | "expired"
  | "cancelled";

export interface SpotlightCampaign {
  id: number;
  event_id: number;
  city_id: number | null;
  organizer_id: string;
  placement: CampaignPlacement;
  priority: number;
  status: CampaignStatus;
  starts_at: string;
  ends_at: string;
  stripe_payment_intent_id: string | null;
  receipt_id: number | null;
  amount_cents: number;
  currency: string;
  created_at: string;
  updated_at: string;
}

export interface SpotlightItem {
  campaign_id: number;
  event_id: number;
  placement: CampaignPlacement;
  priority: number;
  starts_at: string;
  ends_at: string;
  title: string;
  description: string;
  start_date: string;
  end_date: string | null;
  location: string;
  price: number;
  category: string | null;
  total_attendees: number;
  spotlight_image: string;
  cover_image: string;
  host_id: string;
  host_username: string;
  host_avatar: string | null;
}

export type PromotionDuration = "24h" | "7d" | "weekend";

export interface PromotionPricing {
  duration: PromotionDuration;
  label: string;
  description: string;
  price_cents: number;
  price_display: string;
}

export const PROMOTION_PRICING: PromotionPricing[] = [
  {
    duration: "24h",
    label: "24 Hours",
    description: "Quick boost for tonight's event",
    price_cents: 999,
    price_display: "$9.99",
  },
  {
    duration: "7d",
    label: "7 Days",
    description: "Full week of premium visibility",
    price_cents: 3999,
    price_display: "$39.99",
  },
  {
    duration: "weekend",
    label: "Weekend",
    description: "Friday through Sunday spotlight",
    price_cents: 1999,
    price_display: "$19.99",
  },
];
