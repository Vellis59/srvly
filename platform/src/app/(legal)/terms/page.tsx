export default function TermsPage() {
  return (
    <>
      <h1>Terms of Service</h1>
      <p className="text-sm text-zinc-500">Last updated: June 27, 2026</p>

      <h2>1. Acceptance of Terms</h2>
      <p>
        By accessing or using srvly ("the Service"), you agree to be bound by these Terms of Service.
        If you do not agree, you may not use the Service.
      </p>

      <h2>2. Description of Service</h2>
      <p>
        srvly is an open-source VPS management platform that allows users to connect, monitor, and manage
        their servers through a web dashboard. The Service is available both as a hosted platform
        (srvly.app) and as a self-hosted application.
      </p>

      <h2>3. User Accounts</h2>
      <p>
        You must sign in with GitHub to use the hosted Service. You are responsible for maintaining the
        confidentiality of your account and for all activities that occur under your account. You must
        notify us immediately of any unauthorized use of your account.
      </p>

      <h2>4. Acceptable Use</h2>
      <p>You agree not to:</p>
      <ul>
        <li>Use the Service for any illegal purpose</li>
        <li>Attempt to gain unauthorized access to the Service or its systems</li>
        <li>Interfere with or disrupt the integrity or performance of the Service</li>
        <li>Use the Service to deploy malware, ransomware, or malicious software</li>
        <li>Use the Service to attack or compromise other systems</li>
      </ul>

      <h2>5. Self-Hosted Version</h2>
      <p>
        The self-hosted version of srvly is provided under the MIT License. You may modify, distribute,
        and use it subject to the terms of that license. srvly is not responsible for the security or
        maintenance of self-hosted instances.
      </p>

      <h2>6. Limitation of Liability</h2>
      <p>
        srvly is provided "as is" without warranty of any kind. In no event shall srvly be liable for
        any damages arising from the use of the Service, including but not limited to data loss, server
        downtime, or security breaches.
      </p>

      <h2>7. Changes to Terms</h2>
      <p>
        We reserve the right to modify these terms at any time. Users will be notified of material
        changes via email or through the Service. Continued use after changes constitutes acceptance.
      </p>

      <h2>8. Contact</h2>
      <p>
        For questions about these terms, open an issue on{' '}
        <a href="https://github.com/Vellis59/srvly" target="_blank" rel="noopener noreferrer">GitHub</a>.
      </p>
    </>
  );
}
