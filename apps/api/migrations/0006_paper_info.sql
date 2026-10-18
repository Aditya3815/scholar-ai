-- What we learned about an uploaded paper by reading it in the browser (title, DOI, outline, reference list) plus metadata looked
-- up by DOI. One JSON document per paper: it is only ever read and written as a whole, and it goes with the paper when it is deleted.
ALTER TABLE documents ADD COLUMN info TEXT;
