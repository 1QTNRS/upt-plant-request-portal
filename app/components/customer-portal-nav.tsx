const navStyle: React.CSSProperties = {
  display: "flex",
  flexWrap: "wrap",
  alignItems: "center",
  gap: 16,
  padding: "10px 16px",
  margin: "0 0 12px",
  borderBottom: "1px solid rgba(0, 41, 16, 0.18)",
  font: "inherit",
};

const linkStyle: React.CSSProperties = {
  color: "#202223",
  textDecoration: "none",
  minHeight: 44,
  display: "inline-flex",
  alignItems: "center",
};

/**
 * Unobtrusive Home / My Requests chrome for the local customer demo only.
 * App-proxy pages sit inside the shop theme, so this nav is omitted there
 * and UPT's real website menu is what the customer sees. No admin links.
 * Works without hydration.
 */
export function CustomerPortalNav({
  homeHref,
  myRequestsHref,
}: {
  homeHref: string;
  myRequestsHref: string;
}) {
  return (
    <nav aria-label="Customer portal" data-customer-portal-nav style={navStyle}>
      <a href={homeHref} style={linkStyle} data-customer-nav="home">
        Home
      </a>
      <a href={myRequestsHref} style={linkStyle} data-customer-nav="my-requests">
        My Requests
      </a>
    </nav>
  );
}
