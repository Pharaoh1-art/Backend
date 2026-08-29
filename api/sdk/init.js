export default function handler(req, res) {
  if (req.method === 'POST') {
    // اللعبة بتبعت POST، هنرد عليها بـ 200 (يعني نجاح) وبيانات وهمية
    res.status(200).json({
      code: 200, // بعض الألعاب بتستخدم 200 كدليل للنجاح
      status: 1, // وألعاب تانية بتستخدم 1
      message: "success",
      data: {}
    });
  } else {
    res.status(405).json({ message: "Method Not Allowed" });
  }
}
