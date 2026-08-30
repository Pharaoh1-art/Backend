export default function handler(req, res) {
  if (req.method === 'POST') {
    res.status(200).json({
      code: 0,              // بعض الألعاب تعتبر 0 هو كود النجاح الصريح (Success)
      status: 1,
      message: "success",
      data: {
        server_time: Math.floor(Date.now() / 1000),
        status: 1,
        isOpen: true,
        config: {
          force_update: false,
          announcement: "Welcome"
        }
      }
    });
  } else {
    res.status(405).json({ message: "Method Not Allowed" });
  }
}
