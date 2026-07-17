export const PRODUCT = {
  name: "TunNest",
  displayName: "囤囤",
  trialDays: 7,
  browserDeviceLimit: 3,
  actionsLimit: 1,
  licenseApiBase: "https://tunnest-license.example.workers.dev",
  supportUrl: "mailto:support@example.com",
  plans: [
    { id: "monthly", name: "月度", price: "¥9.9", days: 31, checkoutUrl: "https://example.com/buy/monthly" },
    { id: "halfyear", name: "半年", price: "¥19.9", days: 183, checkoutUrl: "https://example.com/buy/halfyear" },
    { id: "yearly", name: "年度", price: "¥39.9", days: 366, checkoutUrl: "https://example.com/buy/yearly" },
    { id: "lifetime", name: "永久", price: "¥299", days: null, checkoutUrl: "https://example.com/buy/lifetime" }
  ]
};
