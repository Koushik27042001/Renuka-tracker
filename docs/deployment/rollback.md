# Rollback

Stop promotion and retain the failed release ID and associated request IDs. Redeploy the last verified API and admin deployment. Preserve MongoDB and Cloudinary state. Confirm that the older API supports existing clients and indexes before rollback. Reissue signing-compatible Android builds with a higher version code if devices already installed the faulty release. Lower or clear a mandatory update setting if the current published build is unavailable.
