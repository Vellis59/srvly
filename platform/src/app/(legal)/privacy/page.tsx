export default function PrivacyPage() {
  return (
    <>
      <h1>Privacy Policy</h1>
      <p className="text-sm text-zinc-500">Last updated: June 27, 2026</p>

      <h2>1. Information We Collect</h2>
      <h3>Account Information</h3>
      <p>
        When you sign in with GitHub, we collect your GitHub username, email address, and avatar URL.
        This information is used to identify you within the Service.
      </p>

      <h3>Server Information</h3>
      <p>
        When you add a server, we store:
      </p>
      <ul>
        <li>Server IP address and hostname</li>
        <li>SSH public key (for authentication)</li>
        <li>Server metrics (CPU, RAM, disk, uptime) collected via SSH</li>
        <li>Application installation records</li>
      </ul>

      <h3>Usage Data</h3>
      <p>
        We collect anonymous usage statistics to improve the Service, including page views and feature
        interactions. No personally identifiable information is included in usage analytics.
      </p>

      <h2>2. How We Use Your Information</h2>
      <ul>
        <li>To provide and maintain the Service</li>
        <li>To authenticate your identity via GitHub OAuth</li>
        <li>To monitor and improve the Service</li>
        <li>To communicate with you about Service updates</li>
      </ul>

      <h2>3. Data Storage and Security</h2>
      <p>
        Data is stored on Hetzner VPS servers in Germany. We implement industry-standard security measures
        including encryption at rest and in transit. SSH keys are stored encrypted in the database and
        are never exposed to other users.
      </p>

      <h2>4. Data Retention</h2>
      <p>
        We retain your data for as long as your account is active. You may request deletion of your
        account and associated data at any time by contacting us via GitHub Issues. Deletion is
        irreversible.
      </p>

      <h2>5. Third-Party Services</h2>
      <p>
        srvly uses the following third-party services:
      </p>
      <ul>
        <li><strong>GitHub</strong> — OAuth authentication</li>
        <li><strong>Cloudflare</strong> — DNS and CDN</li>
        <li><strong>Hetzner</strong> — Server hosting</li>
      </ul>
      <p>
        Each service has its own privacy policy governing data handling.
      </p>

      <h2>6. Self-Hosted Instances</h2>
      <p>
        If you self-host srvly, you are responsible for the data you collect and store. This privacy
        policy applies only to the official hosted instance at srvly.app.
      </p>

      <h2>7. Your Rights</h2>
      <p>
        You have the right to:
      </p>
      <ul>
        <li>Access your personal data</li>
        <li>Correct inaccurate data</li>
        <li>Delete your account and associated data</li>
        <li>Export your data</li>
      </ul>

      <h2>8. Changes to This Policy</h2>
      <p>
        We may update this policy. Users will be notified of material changes via email or through
        the Service.
      </p>

      <h2>9. Contact</h2>
      <p>
        For privacy concerns, open an issue on{' '}
        <a href="https://github.com/Vellis59/srvly" target="_blank" rel="noopener noreferrer">GitHub</a>.
      </p>
    </>
  );
}
