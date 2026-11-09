<%@ WebHandler Language="C#" Class="DishThumbnail" %>
using System;
using System.Drawing;
using System.Drawing.Drawing2D;
using System.Drawing.Imaging;
using System.IO;
using System.Net;
using System.Net.Cache;
using System.Security.Cryptography;
using System.Web;
using System.Web.Caching;

public class DishThumbnail : IHttpHandler {
    public bool IsReusable { get { return true; } }

    public void ProcessRequest(HttpContext context) {
        Guid id;
        if (!Guid.TryParseExact(context.Request.QueryString["id"], "D", out id)) {
            context.Response.StatusCode = 400;
            return;
        }
        string requested = context.Request.QueryString["size"];
        int size = requested == "144" ? 144 : requested == "240" ? 240 : 480;
        byte[] thumbnail;
        try {
            string websiteHost = context.Request.Url.DnsSafeHost.ToLowerInvariant();
            string posHost;
            if (websiteHost == "www.loveanise.co.uk" || websiteHost == "loveanise.co.uk")
                posHost = "pos.loveanise.co.uk";
            else if (websiteHost == "www.staging.loveanise.co.uk" || websiteHost == "staging.loveanise.co.uk")
                posHost = "pos-staging.loveanise.co.uk";
            else {
                context.Response.StatusCode = 400;
                return;
            }
            var request = (HttpWebRequest)WebRequest.Create("https://" + posHost + "/api/menu/products/" + id + "/image");
            request.AllowAutoRedirect = false;
            request.Timeout = 10000;
            request.CachePolicy = new RequestCachePolicy(RequestCacheLevel.NoCacheNoStore);
            using (var response = request.GetResponse())
            using (var stream = response.GetResponseStream())
            using (var source = new MemoryStream()) {
                stream.CopyTo(source);
                string revision;
                using (var hash = SHA256.Create()) {
                    revision = BitConverter.ToString(hash.ComputeHash(source.ToArray())).Replace("-", "");
                }
                string key = "dish-thumbnail-v2-" + size + "-" + id + "-" + revision;
                thumbnail = context.Cache[key] as byte[];
                if (thumbnail == null) {
                    source.Position = 0;
                    using (var original = Image.FromStream(source)) {
                        double scale = Math.Min(1, (double)size / Math.Max(original.Width, original.Height));
                        using (var resized = new Bitmap(Math.Max(1, (int)Math.Round(original.Width * scale)), Math.Max(1, (int)Math.Round(original.Height * scale))))
                        using (var graphics = Graphics.FromImage(resized))
                        using (var output = new MemoryStream()) {
                            graphics.Clear(Color.White);
                            graphics.InterpolationMode = InterpolationMode.HighQualityBicubic;
                            graphics.DrawImage(original, 0, 0, resized.Width, resized.Height);
                            resized.Save(output, ImageFormat.Jpeg);
                            thumbnail = output.ToArray();
                        }
                    }
                    context.Cache.Insert(key, thumbnail, null, DateTime.UtcNow.AddMinutes(15), Cache.NoSlidingExpiration);
                }
            }
        } catch (WebException) {
            context.Response.StatusCode = 502;
            return;
        } catch (ArgumentException) {
            context.Response.StatusCode = 422;
            return;
        }

        context.Response.ContentType = "image/jpeg";
        context.Response.Cache.SetCacheability(HttpCacheability.Public);
        context.Response.Cache.SetMaxAge(TimeSpan.Zero);
        context.Response.Cache.SetRevalidation(HttpCacheRevalidation.AllCaches);
        context.Response.BinaryWrite(thumbnail);
    }
}
