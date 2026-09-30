using SixLabors.ImageSharp;
using SixLabors.ImageSharp.PixelFormats;
using SixLabors.ImageSharp.Processing;

const int softDistance = 68;
const int hardDistance = 38;
const int padding = 2;
var root = FindProjectRoot();
var files = new[]
{
    "ui_btn.png", "ui_btn_hover.png", "ui_panel.png", "ui_dialog.png",
    "icon_yin.png", "icon_min.png", "icon_jun.png", "icon_chao.png",
    "icon_kou.png", "icon_jin.png", "seal_yz.png"
};

foreach (var name in files)
{
    var path = Path.Combine(root, "assets", "icons", name);
    using var image = Image.Load<Rgba32>(path);
    RemoveBorderBackground(image);
    image.SaveAsPng(path);
    Console.WriteLine($"{name} -> {image.Width}x{image.Height}");
}

static string FindProjectRoot()
{
    var candidates = new[]
    {
        new DirectoryInfo(Environment.CurrentDirectory),
        new DirectoryInfo(AppContext.BaseDirectory),
    };
    foreach (var start in candidates)
    {
        var current = start;
        while (current != null)
        {
            if (File.Exists(Path.Combine(current.FullName, "project.godot"))) return current.FullName;
            current = current.Parent;
        }
    }
    throw new DirectoryNotFoundException("project.godot not found");
}

static void RemoveBorderBackground(Image<Rgba32> image)
{
    var width = image.Width;
    var height = image.Height;
    var background = SampleBorderMedian(image);
    var removable = new bool[width * height];
    var queue = new Queue<(int X, int Y)>();

    void Enqueue(int x, int y)
    {
        var index = y * width + x;
        if (removable[index] || Distance(image[x, y], background) > softDistance)
            return;
        removable[index] = true;
        queue.Enqueue((x, y));
    }

    for (var x = 0; x < width; x++) { Enqueue(x, 0); Enqueue(x, height - 1); }
    for (var y = 1; y < height - 1; y++) { Enqueue(0, y); Enqueue(width - 1, y); }
    while (queue.Count > 0)
    {
        var (x, y) = queue.Dequeue();
        if (x > 0) Enqueue(x - 1, y);
        if (x + 1 < width) Enqueue(x + 1, y);
        if (y > 0) Enqueue(x, y - 1);
        if (y + 1 < height) Enqueue(x, y + 1);
    }

    var minX = width; var minY = height; var maxX = -1; var maxY = -1;
    for (var y = 0; y < height; y++)
    for (var x = 0; x < width; x++)
    {
        var index = y * width + x;
        if (removable[index])
        {
            var d = Distance(image[x, y], background);
            var pixel = image[x, y];
            pixel.A = (byte)Math.Clamp((d - hardDistance) * 255 / (softDistance - hardDistance), 0, 255);
            image[x, y] = pixel;
        }
        if (image[x, y].A > 0) { minX = Math.Min(minX, x); minY = Math.Min(minY, y); maxX = Math.Max(maxX, x); maxY = Math.Max(maxY, y); }
    }
    if (maxX < 0) throw new InvalidOperationException("Image became transparent");
    minX = Math.Max(0, minX - padding); minY = Math.Max(0, minY - padding);
    maxX = Math.Min(width - 1, maxX + padding); maxY = Math.Min(height - 1, maxY + padding);
    image.Mutate(ctx => ctx.Crop(new Rectangle(minX, minY, maxX - minX + 1, maxY - minY + 1)));
}

static Rgba32 SampleBorderMedian(Image<Rgba32> image)
{
    var pixels = new List<Rgba32>();
    for (var x = 0; x < image.Width; x++) { pixels.Add(image[x, 0]); pixels.Add(image[x, image.Height - 1]); }
    for (var y = 1; y < image.Height - 1; y++) { pixels.Add(image[0, y]); pixels.Add(image[image.Width - 1, y]); }
    static byte Median(IEnumerable<byte> values) => values.OrderBy(v => v).ElementAt(values.Count() / 2);
    return new Rgba32(Median(pixels.Select(p => p.R)), Median(pixels.Select(p => p.G)), Median(pixels.Select(p => p.B)), 255);
}

static int Distance(Rgba32 a, Rgba32 b) => Math.Abs(a.R - b.R) + Math.Abs(a.G - b.G) + Math.Abs(a.B - b.B);
