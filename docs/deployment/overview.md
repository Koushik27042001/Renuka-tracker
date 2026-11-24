# Deployment overview

Deploy the API from the root Render Blueprint and the admin workspace from Vercel using the repository instructions. Create separate production Atlas and Cloudinary resources. Publish native releases through the company’s approved distribution channels.

Deploy staging first. Confirm the checks in [the launch checklist](../production-launch-checklist.md). Enable offline evidence only after confirming the capture and review policy in staging.

Vercel forwards the dashboard's same-origin API requests to the Render service. Point mobile builds directly to the Render API hostname. Use separate credentials and media folders for staging and production.
